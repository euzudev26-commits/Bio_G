import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type Profile = { id: string; employee_code: string; full_name: string; department: string | null; designation: string | null; biomax_user_id: string | null; employment_status: string };
type DayRow = { id: string; employee_id: string; attendance_date: string; first_in_at: string | null; last_out_at: string | null; status: string; working_minutes: number | null; late_minutes: number | null; issue_codes: string[] | null };
type RequestRow = { id: string; employee_id: string; attendance_date: string; target_punch: string; original_time: string | null; requested_time: string; reason: string; status: string; submitted_at: string; admin_note: string | null };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const showTime = (v: string | null) => v ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
const showDate = (v: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v + 'T00:00:00+05:30'));

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [date, setDate] = useState(today());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [targetPunch, setTargetPunch] = useState('IN');
  const [requestedTime, setRequestedTime] = useState('');
  const [reason, setReason] = useState('');
  const role = session?.user.app_metadata?.role === 'admin' ? 'admin' : session?.user.app_metadata?.role === 'employee' ? 'employee' : null;

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).finally(() => setAuthLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); setError(''); });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase || !session || !role) return;
    setError('');
    const { data: p, error: pError } = await supabase.from('employees').select('id, employee_code, full_name, department, designation, biomax_user_id, employment_status').eq('auth_user_id', session.user.id).maybeSingle();
    if (pError) throw pError;
    setProfile(p as Profile | null);
    if (role === 'admin') {
      const [emp, att, req] = await Promise.all([
        supabase.from('employees').select('id, employee_code, full_name, department, designation, biomax_user_id, employment_status').order('full_name'),
        supabase.from('attendance_daily_summaries').select('*').eq('attendance_date', date).order('first_in_at'),
        supabase.from('attendance_correction_requests').select('*').order('submitted_at', { ascending: false }).limit(100)
      ]);
      if (emp.error) throw emp.error; if (att.error) throw att.error; if (req.error) throw req.error;
      setEmployees((emp.data ?? []) as Profile[]); setRows((att.data ?? []) as DayRow[]); setRequests((req.data ?? []) as RequestRow[]);
    } else if (p) {
      const [att, req] = await Promise.all([
        supabase.from('attendance_daily_summaries').select('*').eq('employee_id', p.id).order('attendance_date', { ascending: false }).limit(90),
        supabase.from('attendance_correction_requests').select('*').eq('employee_id', p.id).order('submitted_at', { ascending: false }).limit(50)
      ]);
      if (att.error) throw att.error; if (req.error) throw req.error;
      setRows((att.data ?? []) as DayRow[]); setRequests((req.data ?? []) as RequestRow[]);
    }
  }, [session, role, date]);

  useEffect(() => { loadData().catch((e: Error) => setError(e.message)); }, [loadData]);

  async function signIn(e: FormEvent) {
    e.preventDefault(); if (!supabase) return;
    setBusy(true); setError('');
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false); if (e1) setError(e1.message);
  }
  async function signOut() { await supabase?.auth.signOut(); setProfile(null); setTab('overview'); }
  async function submitCorrection(e: FormEvent) {
    e.preventDefault(); if (!supabase || !requestedTime || !reason.trim()) return;
    setBusy(true); setError('');
    const local = new Date(requestedTime);
    const { error: e1 } = await supabase.functions.invoke('attendance-actions', { body: { action: 'submit-correction', attendance_date: date, target_punch: targetPunch, requested_time: local.toISOString(), reason: reason.trim() } });
    setBusy(false);
    if (e1) { setError(e1.message); return; }
    setNotice('Correction request submitted to Admin / HR.'); setReason(''); setRequestedTime(''); setTab('requests'); await loadData();
  }
  async function reviewRequest(id: string, decision: 'approved' | 'rejected') {
    if (!supabase) return;
    let adminNote = '';
    if (decision === 'rejected') { adminNote = window.prompt('Reason for rejection:')?.trim() ?? ''; if (adminNote.length < 3) return; }
    if (decision === 'approved' && !window.confirm('Approve this change? The original BioMax punch remains unchanged.')) return;
    const { error: e1 } = await supabase.functions.invoke('attendance-actions', { body: { action: 'review-correction', request_id: id, decision, admin_note: adminNote } });
    if (e1) { setError(e1.message); return; }
    setNotice(`Request ${decision}. Adjustment and audit entry recorded.`); await loadData();
  }

  if (!isSupabaseConfigured) return <div className="setup"><b>G</b><h1>Connect GSONS Attendance</h1><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the deployment environment.</p></div>;
  if (authLoading) return <div className="splash"><b>G</b><p>Connecting to GSONS Attendance…</p></div>;
  if (!session) return <div className="login"><section className="brand-panel"><b className="brand-mark">G</b><p>GSONS INDUSTRIES PRIVATE LIMITED</p><h1>Attendance, made clear.</h1><p>Biometric attendance, employee requests and administrator approvals in one place.</p></section><form className="login-card" onSubmit={signIn}><small>WELCOME BACK</small><h2>Sign in to your account</h2>{error && <p className="error">{error}</p>}<label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button><p className="muted">Need access? Contact Admin / HR to provision your account.</p></form></div>;
  if (!role) return <div className="setup"><b>G</b><h1>Account access not assigned</h1><p>{session.user.email} is authenticated, but needs trusted app_metadata.role set to admin or employee.</p><button onClick={signOut}>Sign out</button></div>;

  const visibleRows = role === 'admin' ? rows : rows;
  const employeeById = new Map(employees.map(e => [e.id, e]));
  const present = visibleRows.filter(r => r.status === 'present').length;
  const pending = requests.filter(r => r.status === 'pending').length;

  return <div className="shell">
    <aside><div className="brand"><b>G</b><span><strong>GSONS</strong><small>ATTENDANCE MANAGER</small></span></div><p className="role-label">{role === 'admin' ? 'ADMIN PORTAL' : 'EMPLOYEE PORTAL'}</p>
      <nav>{(role === 'admin' ? [['overview','Overview'],['attendance','Attendance'],['employees','Employees'],['requests','Correction requests'],['devices','Biometric devices'],['shifts','Shifts & policies'],['reports','Reports']] : [['overview','My overview'],['attendance','My attendance'],['correction','Request correction'],['requests','My requests'],['profile','My profile']]).map(([id,label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}{id === 'requests' && role === 'admin' && pending > 0 && <i>{pending}</i>}</button>)}</nav>
      <footer><span>● Supabase connected</span><small>GSONS Industries Private Limited</small></footer>
    </aside>
    <main><header><div><small>{role === 'admin' ? 'WORKSPACE' : 'SELF SERVICE'} /</small><strong>{tab.charAt(0).toUpperCase() + tab.slice(1)}</strong></div><div className="user"><span>{session.user.email}</span><button onClick={signOut}>Sign out</button></div></header>
      <section className="content">{error && <div className="error">{error}<button onClick={() => setError('')}>×</button></div>}{notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      {tab === 'overview' && <><h1>{role === 'admin' ? 'Attendance overview' : `Welcome, ${profile?.full_name ?? 'Employee'}`}</h1><p className="muted">Company attendance summary · Asia/Kolkata</p><div className="stats"><article><small>{role === 'admin' ? 'Active employees' : 'Your records'}</small><strong>{role === 'admin' ? employees.length : rows.length}</strong></article><article><small>Present {role === 'admin' ? 'today' : 'in loaded records'}</small><strong>{present}</strong></article><article><small>Pending corrections</small><strong>{pending}</strong></article><article><small>Attendance date</small><strong>{showDate(date)}</strong></article></div><h2>{role === 'admin' ? 'Today’s attendance' : 'Recent attendance'}</h2>{role === 'admin' && <label className="date-select">Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}<AttendanceTable rows={rows.slice(0, 12)} people={employeeById} showEmployee={role === 'admin'} /></>}
      {tab === 'attendance' && <><h1>Attendance records</h1>{role === 'admin' && <label className="date-select">Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}<AttendanceTable rows={rows} people={employeeById} showEmployee={role === 'admin'} /></>}
      {tab === 'employees' && role === 'admin' && <><h1>Employees</h1><p className="muted">Employee profiles and BioMax user-ID mapping.</p><div className="table-wrap"><table><thead><tr><th>Name</th><th>Employee code</th><th>BioMax ID</th><th>Department</th><th>Status</th></tr></thead><tbody>{employees.map(e => <tr key={e.id}><td>{e.full_name}</td><td>{e.employee_code}</td><td>{e.biomax_user_id ?? 'Not linked'}</td><td>{e.department ?? '—'}</td><td>{e.employment_status}</td></tr>)}</tbody></table></div></>}
      {tab === 'correction' && role === 'employee' && <><h1>Request attendance correction</h1><p className="muted">Your request goes to Admin / HR for review. Original biometric events remain unchanged.</p><form className="panel form" onSubmit={submitCorrection}><label>Attendance date<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>Punch to correct<select value={targetPunch} onChange={e => setTargetPunch(e.target.value)}><option value="IN">IN punch</option><option value="OUT">OUT punch</option></select></label><label>Requested date and time<input type="datetime-local" value={requestedTime} onChange={e => setRequestedTime(e.target.value)} required /></label><label>Reason<textarea rows={4} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} required /></label><button disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button></form></>}
      {tab === 'requests' && <><h1>{role === 'admin' ? 'Correction requests' : 'My correction requests'}</h1><div className="table-wrap"><table><thead><tr><th>Date</th><th>Punch</th><th>Original</th><th>Requested</th><th>Reason</th><th>Status</th>{role === 'admin' && <th>Action</th>}</tr></thead><tbody>{requests.map(r => <tr key={r.id}><td>{showDate(r.attendance_date)}</td><td>{r.target_punch}</td><td>{showTime(r.original_time)}</td><td>{showTime(r.requested_time)}</td><td>{r.reason}</td><td><span className={'pill ' + r.status}>{r.status}</span>{r.admin_note && <small>{r.admin_note}</small>}</td>{role === 'admin' && <td>{r.status === 'pending' ? <div className="actions"><button onClick={() => reviewRequest(r.id,'approved')}>Approve</button><button className="reject" onClick={() => reviewRequest(r.id,'rejected')}>Reject</button></div> : 'Reviewed'}</td>}</tr>)}</tbody></table>{!requests.length && <p className="empty">No correction requests found.</p>}</div></>}
      {['devices','shifts','reports','profile'].includes(tab) && <div className="panel"><h2>{tab.charAt(0).toUpperCase() + tab.slice(1)} setup is next</h2><p>This section will be activated after device collection, shift policy configuration and employee onboarding are completed.</p></div>}
      </section>
    </main>
  </div>;
}

function AttendanceTable({ rows, people, showEmployee }: { rows: DayRow[]; people: Map<string, Profile>; showEmployee: boolean }) {
  return <div className="table-wrap"><table><thead><tr>{showEmployee && <th>Employee</th>}<th>Date</th><th>First IN</th><th>Last OUT</th><th>Working time</th><th>Late</th><th>Status</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}>{showEmployee && <td>{people.get(r.employee_id)?.full_name ?? r.employee_id.slice(0,8)}</td>}<td>{showDate(r.attendance_date)}</td><td>{showTime(r.first_in_at)}</td><td>{showTime(r.last_out_at)}</td><td>{r.working_minutes == null ? '—' : `${Math.floor(r.working_minutes/60)}h ${r.working_minutes%60}m`}</td><td>{r.late_minutes == null ? '—' : `${r.late_minutes} min`}</td><td><span className={'pill ' + r.status}>{r.status}</span>{r.issue_codes?.length ? <small>{r.issue_codes.join(', ')}</small> : null}</td></tr>)}</tbody></table>{!rows.length && <p className="empty">No attendance records have been loaded for this date.</p>}</div>;
}
