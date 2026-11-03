import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import AdminDashboard from './components/AdminDashboard';
import EmployeeManagement from './components/EmployeeManagement';
import type { EmployeeInput } from './components/EmployeeManagement';
import AttendanceRegister from './components/AttendanceRegister';
import type { PunchEvent } from './components/AttendanceRegister';
import DeviceMonitoring from './components/DeviceMonitoring';

type Profile = { id: string; employee_code: string; full_name: string; department: string | null; designation: string | null; biomax_user_id: string | null; employment_status: string; email: string | null; phone: string | null; joined_on: string | null; auth_user_id: string | null };
type DayRow = { id: string; employee_id: string; attendance_date: string; first_in_at: string | null; last_out_at: string | null; status: string; working_minutes: number | null; late_minutes: number | null; early_leave_minutes: number | null; manual_break_minutes: number | null; manual_break_recorded_at: string | null; manual_break_note: string | null; issue_codes: string[] | null };
type ShiftRow = { id: string; shift_code: string; shift_name: string; start_time: string; end_time: string; grace_minutes: number; scheduled_break_minutes: number; break_deduction_mode: string; working_days: number[]; weekly_off_days: number[]; effective_from?: string };
type RequestRow = { id: string; employee_id: string; attendance_date: string; target_punch: string; original_time: string | null; requested_time: string; reason: string; status: string; submitted_at: string; admin_note: string | null };
type DeviceRow = { id: string; device_name: string; serial_number: string; is_active: boolean; last_seen_at: string | null; site_name: string | null; ip_address: string | null };
type SyncRunRow = { id: string; run_type: string; started_at: string; completed_at: string | null; status: string; records_seen: number; records_inserted: number; records_duplicate: number; records_failed: number; last_error: string | null };
type RecalcTotals = { input_events: number; valid_employee_events: number; employee_days: number; present_days: number; incomplete_days: number; pending_current_days: number; days_with_intermediate_punches: number; unassigned_events: number; invalid_events: number };
type RecalcPreviewRow = { employee_id: string | null; employee_code: string | null; employee_name: string | null; biomax_user_id: string; attendance_date: string; punch_count: number; first_in_at: string | null; last_out_at: string | null; status: string; late_minutes: number | null; early_leave_minutes: number | null; issue_codes: string[] };
type RecalcResponse = { ok: boolean; action: 'preview' | 'apply'; persisted: boolean; date_range: { start_date: string; end_date: string }; totals?: RecalcTotals; preview_rows?: RecalcPreviewRow[]; preview_rows_limit?: number; unassigned_event_samples?: unknown[]; invalid_event_samples?: unknown[]; summaries_written?: number; protected_days_skipped?: number; working_minutes_calculated?: boolean; note?: string; error?: string };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const showTime = (v: string | null) => v ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
const showDate = (v: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v + 'T00:00:00+05:30'));
const daysAgo = (days: number) => {
  const [year, month, day] = today().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - days));
  return date.toISOString().slice(0, 10);
};
const nextDate = (value: string) => {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

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
  const [weeklyRows, setWeeklyRows] = useState<DayRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [registerStartDate, setRegisterStartDate] = useState(daysAgo(6));
  const [registerEndDate, setRegisterEndDate] = useState(today());
  const [registerAppliedRange, setRegisterAppliedRange] = useState({ start: daysAgo(6), end: today() });
  const [registerRows, setRegisterRows] = useState<DayRow[]>([]);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [punchRow, setPunchRow] = useState<DayRow | null>(null);
  const [punchEvents, setPunchEvents] = useState<PunchEvent[]>([]);
  const [punchLoading, setPunchLoading] = useState(false);
  const [generalShift, setGeneralShift] = useState<ShiftRow | null>(null);
  const [targetPunch, setTargetPunch] = useState('IN');
  const [requestedTime, setRequestedTime] = useState('');
  const [reason, setReason] = useState('');
  const [recalcStartDate, setRecalcStartDate] = useState('2026-10-27');
  const [recalcEndDate, setRecalcEndDate] = useState(today());
  const [recalcPreview, setRecalcPreview] = useState<RecalcResponse | null>(null);
  const [recalcResult, setRecalcResult] = useState<RecalcResponse | null>(null);
  const role = session?.user.app_metadata?.role === 'admin' ? 'admin' : session?.user.app_metadata?.role === 'employee' ? 'employee' : null;

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).finally(() => setAuthLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); setError(''); });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase || !session || !role) return;
    setRefreshing(true);
    setError('');
    try {
      const { data: p, error: pError } = await supabase.from('employees').select('id, employee_code, full_name, department, designation, biomax_user_id, employment_status, email, phone, joined_on, auth_user_id').eq('auth_user_id', session.user.id).maybeSingle();
      if (pError) throw pError;
      setProfile(p as Profile | null);
      if (role === 'admin') {
        const [year, month, day] = date.split('-').map(Number);
        const trendStart = new Date(Date.UTC(year, month - 1, day - 6)).toISOString().slice(0, 10);
        const [emp, att, req, shift, week, deviceRows, runs] = await Promise.all([
          supabase.from('employees').select('id, employee_code, full_name, department, designation, biomax_user_id, employment_status, email, phone, joined_on, auth_user_id').order('full_name'),
          supabase.from('attendance_daily_summaries').select('*').eq('attendance_date', date).order('first_in_at'),
          supabase.from('attendance_correction_requests').select('*').order('submitted_at', { ascending: false }).limit(100),
          supabase.from('shifts').select('id, shift_code, shift_name, start_time, end_time, grace_minutes, scheduled_break_minutes, break_deduction_mode, working_days, weekly_off_days').eq('shift_code', 'GS-01').maybeSingle(),
          supabase.from('attendance_daily_summaries').select('id, employee_id, attendance_date, first_in_at, last_out_at, status, working_minutes, late_minutes, early_leave_minutes, manual_break_minutes, manual_break_recorded_at, manual_break_note, issue_codes').gte('attendance_date', trendStart).lte('attendance_date', date).order('attendance_date'),
          supabase.from('attendance_devices').select('id, device_name, serial_number, is_active, last_seen_at, site_name, ip_address').order('device_name'),
          supabase.from('collector_sync_runs').select('id, run_type, started_at, completed_at, status, records_seen, records_inserted, records_duplicate, records_failed, last_error').order('started_at', { ascending: false }).limit(25)
        ]);
        if (emp.error) throw emp.error;
        if (att.error) throw att.error;
        if (req.error) throw req.error;
        if (shift.error) throw shift.error;
        if (week.error) throw week.error;
        if (deviceRows.error) throw deviceRows.error;
        if (runs.error) throw runs.error;
        setEmployees((emp.data ?? []) as Profile[]);
        setRows((att.data ?? []) as DayRow[]);
        setRequests((req.data ?? []) as RequestRow[]);
        setGeneralShift(shift.data as ShiftRow | null);
        setWeeklyRows((week.data ?? []) as DayRow[]);
        setDevices((deviceRows.data ?? []) as DeviceRow[]);
        setSyncRuns((runs.data ?? []) as SyncRunRow[]);
      } else if (p) {
        const [att, req] = await Promise.all([
          supabase.from('attendance_daily_summaries').select('*').eq('employee_id', p.id).order('attendance_date', { ascending: false }).limit(90),
          supabase.from('attendance_correction_requests').select('*').eq('employee_id', p.id).order('submitted_at', { ascending: false }).limit(50)
        ]);
        if (att.error) throw att.error;
        if (req.error) throw req.error;
        setRows((att.data ?? []) as DayRow[]);
        setRequests((req.data ?? []) as RequestRow[]);
      }
      setLastRefreshed(new Date().toISOString());
    } finally {
      setRefreshing(false);
    }
  }, [session, role, date]);

  useEffect(() => { loadData().catch((e: Error) => setError(e.message)); }, [loadData]);

  useEffect(() => {
    if (role !== 'admin' || tab !== 'overview') return;
    const timer = window.setInterval(() => {
      loadData().catch((e: Error) => setError(e.message));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadData, role, tab]);

  const loadAttendanceRegister = useCallback(async (start: string, end: string) => {
    if (!supabase || !session || role !== 'admin') return;
    if (!start || !end || start > end) {
      setError('Choose a valid attendance date range.');
      return;
    }
    const rangeDays = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000) + 1;
    if (rangeDays > 31) {
      setError('For performance, choose a maximum 31-day range at a time.');
      return;
    }
    setRegisterLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('attendance_daily_summaries')
        .select('*')
        .gte('attendance_date', start)
        .lte('attendance_date', end)
        .order('attendance_date', { ascending: false })
        .order('first_in_at', { ascending: true })
        .limit(1000);
      if (queryError) throw queryError;
      setRegisterRows((data ?? []) as DayRow[]);
    } finally {
      setRegisterLoading(false);
    }
  }, [session, role]);

  useEffect(() => {
    if (role === 'admin' && tab === 'attendance') {
      loadAttendanceRegister(registerAppliedRange.start, registerAppliedRange.end)
        .catch((e: Error) => setError(e.message));
    }
  }, [loadAttendanceRegister, registerAppliedRange, role, tab]);

  async function loadPunchDetails(row: DayRow) {
    if (!supabase || role !== 'admin') return;
    setPunchRow(row);
    setPunchEvents([]);
    setPunchLoading(true);
    setError('');
    try {
      const fromUtc = new Date(row.attendance_date + 'T00:00:00+05:30').toISOString();
      const toUtc = new Date(nextDate(row.attendance_date) + 'T00:00:00+05:30').toISOString();
      const { data, error: queryError } = await supabase
        .from('raw_punch_events')
        .select('id, biomax_user_id, occurred_at, raw_in_out, io_mode, verify_mode, door_mode, source_channel')
        .eq('employee_id', row.employee_id)
        .gte('occurred_at', fromUtc)
        .lt('occurred_at', toUtc)
        .order('occurred_at', { ascending: true })
        .limit(250);
      if (queryError) throw queryError;
      setPunchEvents((data ?? []) as PunchEvent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Original punch history could not be loaded.');
    } finally {
      setPunchLoading(false);
    }
  }

  async function saveEmployee(id: string | null, value: EmployeeInput) {
    if (!supabase || role !== 'admin') throw new Error('Only Admin / HR can save employee profiles.');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = id
        ? await supabase.from('employees').update(value).eq('id', id).select('id').single()
        : await supabase.from('employees').insert(value).select('id').single();
      if (result.error) throw result.error;
      setNotice(id ? 'Employee profile updated successfully.' : 'Employee profile created successfully.');
      await loadData();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Employee profile could not be saved.';
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

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

  async function runAttendanceRecalculation(action: 'preview' | 'apply') {
    if (!supabase) return;
    if (!recalcStartDate || !recalcEndDate || recalcStartDate > recalcEndDate) {
      setError('Choose a valid attendance date range.');
      return;
    }
    if (action === 'apply') {
      if (!recalcPreview || recalcPreview.date_range.start_date !== recalcStartDate || recalcPreview.date_range.end_date !== recalcEndDate) {
        setError('Run a fresh preview for the selected dates before applying.');
        return;
      }
      if ((recalcPreview.totals?.invalid_events ?? 0) > 0) {
        setError('Apply is blocked because the preview contains invalid raw events. Review the event samples first.');
        return;
      }
      if (!window.confirm(
        'Apply the reviewed attendance calculation for ' + showDate(recalcStartDate) + ' to ' + showDate(recalcEndDate) + '?\n\nOnly derived attendance summaries will be rebuilt. Raw BioMax punches will not be changed. Approved corrections, leave / holiday / weekly-off entries, and recorded manual breaks are protected.'
      )) return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body: Record<string, unknown> = {
        start_date: recalcStartDate,
        end_date: recalcEndDate,
        action,
      };
      if (action === 'apply') body.confirm_apply = 'REBUILD_DERIVED_SUMMARIES';
      const { data, error: invokeError } = await supabase.functions.invoke('attendance-recalculate', { body });
      if (invokeError) throw invokeError;
      const result = data as RecalcResponse;
      if (!result?.ok) throw new Error(result?.error ?? 'Attendance recalculation did not complete.');
      if (action === 'preview') {
        setRecalcPreview(result);
        setRecalcResult(null);
        setNotice('Preview completed. No attendance summaries have been changed yet.');
      } else {
        setRecalcResult(result);
        setRecalcPreview(null);
        setNotice('Attendance summaries updated. Raw biometric history remains unchanged.');
        await loadData();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attendance recalculation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function recordManualBreak(row: DayRow) {
    if (!supabase) return;
    if (!row.first_in_at || !row.last_out_at) {
      setError('A valid first IN and last OUT are required before recording a break.');
      return;
    }
    const entered = window.prompt(
      'Enter actual break duration in minutes for ' + showDate(row.attendance_date) + '.\nThe scheduled 60 minutes is a reference only; it will not be deducted automatically.',
      row.manual_break_minutes == null ? '60' : String(row.manual_break_minutes)
    );
    if (entered == null) return;
    const minutes = Number(entered.trim());
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 720) {
      setError('Enter a whole number of break minutes between 0 and 720.');
      return;
    }
    const note = window.prompt('Optional HR note for this break entry (leave blank when not needed):', row.manual_break_note ?? '') ?? '';
    if (!window.confirm('Save ' + minutes + ' manual break minutes for ' + showDate(row.attendance_date) + '? Net working time will be recalculated.')) return;
    setBusy(true); setError('');
    const { error: saveError } = await supabase.functions.invoke('attendance-manual-break', {
      body: { employee_id: row.employee_id, attendance_date: row.attendance_date, manual_break_minutes: minutes, note: note.trim() || null }
    });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    setNotice('Manual break saved. Net working minutes and the HR audit entry were updated.');
    await loadData();
    if (role === 'admin' && tab === 'attendance') {
      await loadAttendanceRegister(registerAppliedRange.start, registerAppliedRange.end);
    }
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
      <nav>{(role === 'admin' ? [['overview','Overview'],['attendance','Attendance'],['employees','Employees'],['requests','Correction requests'],['devices','Biometric devices'],['recalculate','Recalculate'],['shifts','Shifts & policies'],['reports','Reports']] : [['overview','My overview'],['attendance','My attendance'],['correction','Request correction'],['requests','My requests'],['profile','My profile']]).map(([id,label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}{id === 'requests' && role === 'admin' && pending > 0 && <i>{pending}</i>}</button>)}</nav>
      <footer><span>● Supabase connected</span><small>GSONS Industries Private Limited</small></footer>
    </aside>
    <main><header><div><small>{role === 'admin' ? 'WORKSPACE' : 'SELF SERVICE'} /</small><strong>{tab.charAt(0).toUpperCase() + tab.slice(1)}</strong></div><div className="user"><span>{session.user.email}</span><button onClick={signOut}>Sign out</button></div></header>
      <section className="content">{error && <div className="error">{error}<button onClick={() => setError('')}>×</button></div>}{notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      {tab === 'overview' && role === 'admin' && <AdminDashboard employees={employees} rows={rows} weeklyRows={weeklyRows} requests={requests} devices={devices} syncRuns={syncRuns} selectedDate={date} lastRefreshed={lastRefreshed} refreshing={refreshing} onDateChange={setDate} onRefresh={() => loadData().catch((e: Error) => setError(e.message))} onNavigate={setTab} />}
      {tab === 'overview' && role === 'employee' && <><h1>{`Welcome, ${profile?.full_name ?? 'Employee'}`}</h1><p className="muted">Your attendance summary · Asia/Kolkata</p><div className="stats"><article><small>Your records</small><strong>{rows.length}</strong></article><article><small>Present in loaded records</small><strong>{present}</strong></article><article><small>Pending corrections</small><strong>{pending}</strong></article><article><small>Attendance date</small><strong>{showDate(date)}</strong></article></div><h2>Recent attendance</h2><AttendanceTable rows={rows.slice(0, 12)} people={employeeById} showEmployee={false} /></>}
      {tab === 'attendance' && role === 'admin' && <AttendanceRegister employees={employees} rows={registerRows} startDate={registerStartDate} endDate={registerEndDate} loading={registerLoading} punchRow={punchRow} punchEvents={punchEvents} punchLoading={punchLoading} onStartDateChange={setRegisterStartDate} onEndDateChange={setRegisterEndDate} onApply={() => setRegisterAppliedRange({ start: registerStartDate, end: registerEndDate })} onViewPunches={loadPunchDetails} onClosePunches={() => { setPunchRow(null); setPunchEvents([]); }} onRecordManualBreak={recordManualBreak} />}
      {tab === 'attendance' && role === 'employee' && <><h1>My attendance</h1><p className="muted">Your recent attendance records · Asia/Kolkata</p><AttendanceTable rows={rows} people={employeeById} showEmployee={false} /></>}
      {tab === 'employees' && role === 'admin' && <EmployeeManagement employees={employees} saving={busy} onSave={saveEmployee} onRefresh={() => loadData().catch((e: Error) => setError(e.message))} />}
      {tab === 'correction' && role === 'employee' && <><h1>Request attendance correction</h1><p className="muted">Your request goes to Admin / HR for review. Original biometric events remain unchanged.</p><form className="panel form" onSubmit={submitCorrection}><label>Attendance date<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>Punch to correct<select value={targetPunch} onChange={e => setTargetPunch(e.target.value)}><option value="IN">IN punch</option><option value="OUT">OUT punch</option></select></label><label>Requested date and time<input type="datetime-local" value={requestedTime} onChange={e => setRequestedTime(e.target.value)} required /></label><label>Reason<textarea rows={4} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} required /></label><button disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button></form></>}
      {tab === 'requests' && <><h1>{role === 'admin' ? 'Correction requests' : 'My correction requests'}</h1><div className="table-wrap"><table><thead><tr><th>Date</th><th>Punch</th><th>Original</th><th>Requested</th><th>Reason</th><th>Status</th>{role === 'admin' && <th>Action</th>}</tr></thead><tbody>{requests.map(r => <tr key={r.id}><td>{showDate(r.attendance_date)}</td><td>{r.target_punch}</td><td>{showTime(r.original_time)}</td><td>{showTime(r.requested_time)}</td><td>{r.reason}</td><td><span className={'pill ' + r.status}>{r.status}</span>{r.admin_note && <small>{r.admin_note}</small>}</td>{role === 'admin' && <td>{r.status === 'pending' ? <div className="actions"><button onClick={() => reviewRequest(r.id,'approved')}>Approve</button><button className="reject" onClick={() => reviewRequest(r.id,'rejected')}>Reject</button></div> : 'Reviewed'}</td>}</tr>)}</tbody></table>{!requests.length && <p className="empty">No correction requests found.</p>}</div></>}
      {tab === 'shifts' && role === 'admin' && <><h1>Shift & attendance policy</h1><p className="muted">Active company shift and break recording rules.</p>{generalShift ? <div className="panel shift-policy"><div className="policy-heading"><div><small>ACTIVE SHIFT</small><h2>{generalShift.shift_name}</h2><strong>{generalShift.shift_code}</strong></div><span className="pill approved">Active</span></div><div className="policy-grid"><div><small>Shift timing</small><strong>{generalShift.start_time.slice(0,5)} – {generalShift.end_time.slice(0,5)}</strong></div><div><small>Late grace</small><strong>{generalShift.grace_minutes} minutes</strong></div><div><small>Scheduled break reference</small><strong>{generalShift.scheduled_break_minutes} minutes</strong></div><div><small>Break deduction</small><strong>{generalShift.break_deduction_mode === 'manual' ? 'Manual HR entry' : 'Automatic'}</strong></div><div><small>Working days</small><strong>Monday – Saturday</strong></div><div><small>Weekly off</small><strong>Sunday</strong></div><div><small>Effective from</small><strong>23 Dec 2025</strong></div><div><small>Net working time</small><strong>Only after break entry</strong></div></div><p className="muted policy-note">No 60-minute break is deducted by default. HR records the actual break duration on each completed attendance day. Employee joining dates remain blank and no absence is created before a verified joining date.</p></div> : <div className="panel"><p>GS-01 shift is not available.</p></div>}<div className="panel"><h2>Manual break procedure</h2><p>Open Attendance, select a date, and use Record break for an employee with both IN and OUT punches. Saving a break updates net working minutes and writes an audit entry showing the HR user, time, and note. Raw BioMax punches are never changed.</p></div></>}
      {tab === 'recalculate' && role === 'admin' && <>
        <h1>Recalculate attendance</h1>
        <p className="muted">Rebuild derived daily summaries from the immutable BioMax punch history. Preview first, then apply only after reviewing the result.</p>
        <div className="panel recalc-panel">
          <div className="recalc-controls">
            <label>From date<input type="date" value={recalcStartDate} onChange={e => { setRecalcStartDate(e.target.value); setRecalcPreview(null); setRecalcResult(null); }} /></label>
            <label>To date<input type="date" value={recalcEndDate} onChange={e => { setRecalcEndDate(e.target.value); setRecalcPreview(null); setRecalcResult(null); }} /></label>
          </div>
          <div className="recalc-actions">
            <button disabled={busy} onClick={() => runAttendanceRecalculation('preview')}>{busy ? 'Processing…' : 'Preview calculation'}</button>
            {recalcPreview && <button disabled={busy || (recalcPreview.totals?.invalid_events ?? 0) > 0} onClick={() => runAttendanceRecalculation('apply')}>Apply reviewed preview</button>}
          </div>
          <p className="muted policy-note">The preview does not write data. Apply updates only derived attendance summaries. Raw punch events, approved correction history, leave / holiday / weekly-off entries and existing manual break entries are preserved. Working minutes remain blank until an actual manual break is recorded. No automatic absence is generated.</p>
        </div>
        {recalcPreview && <>
          <h2>Preview results · {showDate(recalcPreview.date_range.start_date)} – {showDate(recalcPreview.date_range.end_date)}</h2>
          <div className="stats recalc-stats">
            <article><small>Raw events checked</small><strong>{recalcPreview.totals?.input_events ?? 0}</strong></article>
            <article><small>Employee-days</small><strong>{recalcPreview.totals?.employee_days ?? 0}</strong></article>
            <article><small>Present days</small><strong>{recalcPreview.totals?.present_days ?? 0}</strong></article>
            <article><small>Incomplete days</small><strong>{recalcPreview.totals?.incomplete_days ?? 0}</strong></article>
            <article><small>Current-day pending</small><strong>{recalcPreview.totals?.pending_current_days ?? 0}</strong></article>
            <article><small>Unassigned events</small><strong>{recalcPreview.totals?.unassigned_events ?? 0}</strong></article>
          </div>
          {(recalcPreview.totals?.invalid_events ?? 0) > 0 && <div className="error">There are {recalcPreview.totals?.invalid_events} invalid event(s). Applying this preview is disabled until they are reviewed.</div>}
          <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Punches</th><th>First IN</th><th>Last OUT</th><th>Late</th><th>Early out</th><th>Status</th></tr></thead><tbody>
            {(recalcPreview.preview_rows ?? []).slice(0, 100).map((r, i) => <tr key={r.employee_id + '|' + r.attendance_date + '|' + i}>
              <td>{r.employee_name ?? r.employee_code ?? r.biomax_user_id}</td><td>{showDate(r.attendance_date)}</td><td>{r.punch_count}</td><td>{showTime(r.first_in_at)}</td><td>{showTime(r.last_out_at)}</td><td>{r.late_minutes == null ? '—' : String(r.late_minutes) + ' min'}</td><td>{r.early_leave_minutes == null ? '—' : String(r.early_leave_minutes) + ' min'}</td><td><span className={'pill ' + r.status}>{r.status}</span>{r.issue_codes?.length ? <small>{r.issue_codes.join(', ')}</small> : null}</td>
            </tr>)}
          </tbody></table></div>
          <p className="muted">{recalcPreview.preview_rows_limit ? 'Showing up to ' + recalcPreview.preview_rows_limit + ' preview rows. ' : ''}{recalcPreview.note}</p>
        </>}
        {recalcResult && <div className="panel recalc-result">
          <h2>Recalculation applied</h2>
          <div className="stats">
            <article><small>Summaries written</small><strong>{recalcResult.summaries_written ?? 0}</strong></article>
            <article><small>Protected days skipped</small><strong>{recalcResult.protected_days_skipped ?? 0}</strong></article>
            <article><small>Employee-days reviewed</small><strong>{recalcResult.totals?.employee_days ?? 0}</strong></article>
          </div>
          <p>{recalcResult.note}</p>
        </div>}
      </>}
      {tab === 'devices' && role === 'admin' && <DeviceMonitoring devices={devices} syncRuns={syncRuns} refreshing={refreshing} onRefresh={() => loadData().catch((e: Error) => setError(e.message))} />}
      {['reports','profile'].includes(tab) && <div className="panel"><h2>{tab.charAt(0).toUpperCase() + tab.slice(1)} setup is next</h2><p>This section will be activated after the reporting and employee self-service phases are completed.</p></div>}
      </section>
    </main>
  </div>;
}

function AttendanceTable({ rows, people, showEmployee, onRecordManualBreak }: { rows: DayRow[]; people: Map<string, Profile>; showEmployee: boolean; onRecordManualBreak?: (row: DayRow) => void }) {
  return <div className="table-wrap"><table><thead><tr>{showEmployee && <th>Employee</th>}<th>Date</th><th>First IN</th><th>Last OUT</th><th>Manual break</th><th>Net working time</th><th>Late</th><th>Early out</th><th>Status</th>{showEmployee && <th>HR action</th>}</tr></thead><tbody>{rows.map(r => <tr key={r.id}>{showEmployee && <td>{people.get(r.employee_id)?.full_name ?? r.employee_id.slice(0,8)}</td>}<td>{showDate(r.attendance_date)}</td><td>{showTime(r.first_in_at)}</td><td>{showTime(r.last_out_at)}</td><td>{r.manual_break_minutes == null ? 'Not recorded' : `${r.manual_break_minutes} min`}{r.manual_break_recorded_at && <small>Saved {showTime(r.manual_break_recorded_at)}</small>}</td><td>{r.working_minutes == null ? '—' : `${Math.floor(r.working_minutes/60)}h ${r.working_minutes%60}m`}</td><td>{r.late_minutes == null ? '—' : `${r.late_minutes} min`}</td><td>{r.early_leave_minutes == null ? '—' : `${r.early_leave_minutes} min`}</td><td><span className={'pill ' + r.status}>{r.status}</span>{r.issue_codes?.length ? <small>{r.issue_codes.join(', ')}</small> : null}</td>{showEmployee && <td>{onRecordManualBreak && r.first_in_at && r.last_out_at ? <button className="break-action" onClick={() => onRecordManualBreak(r)}>{r.manual_break_minutes == null ? 'Record break' : 'Edit break'}</button> : <span className="muted">IN + OUT required</span>}</td>}</tr>)}</tbody></table>{!rows.length && <p className="empty">No attendance records have been loaded for this date.</p>}</div>;
}
