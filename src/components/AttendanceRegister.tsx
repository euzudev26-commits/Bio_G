import { useMemo, useState } from 'react';

export type AttendanceEmployee = {
  id: string;
  employee_code: string;
  full_name: string;
  department: string | null;
  biomax_user_id: string | null;
};

export type AttendanceRecord = {
  id: string;
  employee_id: string;
  attendance_date: string;
  first_in_at: string | null;
  last_out_at: string | null;
  status: string;
  working_minutes: number | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  manual_break_minutes: number | null;
  manual_break_recorded_at: string | null;
  manual_break_note: string | null;
  issue_codes: string[] | null;
};

export type PunchEvent = {
  id: string;
  biomax_user_id: string;
  occurred_at: string;
  raw_in_out: string | null;
  io_mode: number | null;
  verify_mode: string | null;
  door_mode: string | null;
  source_channel: string;
};

type Props = {
  employees: AttendanceEmployee[];
  rows: AttendanceRecord[];
  startDate: string;
  endDate: string;
  loading: boolean;
  punchRow: AttendanceRecord | null;
  punchEvents: PunchEvent[];
  punchLoading: boolean;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onApply: () => void;
  onViewPunches: (row: AttendanceRecord) => void;
  onClosePunches: () => void;
  onRecordManualBreak: (row: AttendanceRecord) => void;
};

const dateText = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value + 'T00:00:00+05:30'));

const timeText = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
    : '—';

const dateTimeText = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .format(new Date(value));

const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const csv = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"';

export default function AttendanceRegister({
  employees,
  rows,
  startDate,
  endDate,
  loading,
  punchRow,
  punchEvents,
  punchLoading,
  onStartDateChange,
  onEndDateChange,
  onApply,
  onViewPunches,
  onClosePunches,
  onRecordManualBreak,
}: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const employeeMap = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const employee = employeeMap.get(row.employee_id);
      const matchesText = !term || [
        employee?.full_name ?? '',
        employee?.employee_code ?? '',
        employee?.biomax_user_id ?? '',
        employee?.department ?? '',
      ].some((value) => value.toLowerCase().includes(term));
      return matchesText && (statusFilter === 'all' || row.status === statusFilter);
    });
  }, [rows, employeeMap, search, statusFilter]);

  const present = visibleRows.filter((row) => row.status === 'present').length;
  const incomplete = visibleRows.filter((row) => row.status === 'incomplete').length;
  const pending = visibleRows.filter((row) => row.status === 'pending').length;
  const missingOut = visibleRows.filter((row) => row.first_in_at && !row.last_out_at).length;

  function exportCsv() {
    const headings = ['Date', 'Employee', 'Employee code', 'BioMax ID', 'Department', 'First IN', 'Last OUT', 'Break minutes', 'Working minutes', 'Late minutes', 'Early leave minutes', 'Status', 'Issues'];
    const lines = visibleRows.map((row) => {
      const employee = employeeMap.get(row.employee_id);
      return [
        row.attendance_date,
        employee?.full_name ?? '',
        employee?.employee_code ?? '',
        employee?.biomax_user_id ?? '',
        employee?.department ?? '',
        row.first_in_at ?? '',
        row.last_out_at ?? '',
        row.manual_break_minutes ?? '',
        row.working_minutes ?? '',
        row.late_minutes ?? '',
        row.early_leave_minutes ?? '',
        row.status,
        (row.issue_codes ?? []).join('; '),
      ].map(csv).join(',');
    });
    const content = [headings.map(csv).join(','), ...lines].join('\r\n');
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'GSONS_Attendance_' + startDate + '_' + endDate + '.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="attendance-register">
      <section className="module-heading">
        <div>
          <span className="module-kicker">ATTENDANCE OPERATIONS</span>
          <h1>Attendance register</h1>
          <p>Search attendance summaries, inspect original biometric punches and export filtered records.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onApply} disabled={loading}>↻ Refresh records</button>
      </section>

      <section className="panel register-filters">
        <label>From date<input type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} /></label>
        <label>To date<input type="date" value={endDate} onChange={(event) => onEndDateChange(event.target.value)} /></label>
        <button type="button" onClick={onApply} disabled={loading || !startDate || !endDate || startDate > endDate}>{loading ? 'Loading…' : 'Apply date range'}</button>
        <span className="module-footnote">Up to 1,000 summary rows per query.</span>
      </section>

      <section className="register-summary">
        <div><span>Summary records</span><strong>{visibleRows.length}</strong></div>
        <div><span>Present</span><strong>{present}</strong></div>
        <div><span>Incomplete</span><strong>{incomplete}</strong></div>
        <div><span>IN without OUT</span><strong>{missingOut}</strong></div>
        <div><span>Pending</span><strong>{pending}</strong></div>
      </section>

      <section className="panel register-table-panel">
        <div className="register-list-toolbar">
          <label className="module-search">Find employee<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, employee code, BioMax ID..." /></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="present">Present</option><option value="incomplete">Incomplete</option><option value="pending">Pending</option><option value="absent">Absent</option><option value="leave">Leave</option><option value="weekly_off">Weekly off</option><option value="holiday">Holiday</option></select></label>
          <span className="employee-result-count">{visibleRows.length} records</span>
          <button type="button" className="secondary-button" onClick={exportCsv} disabled={!visibleRows.length}>↓ Export CSV</button>
        </div>
        <div className="table-wrap register-table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Employee</th><th>First IN</th><th>Last OUT</th><th>Break</th><th>Working time</th><th>Late</th><th>Early out</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleRows.map((row) => {
                const employee = employeeMap.get(row.employee_id);
                return (
                  <tr key={row.id}>
                    <td>{dateText(row.attendance_date)}</td>
                    <td><strong>{employee?.full_name ?? 'Employee profile unavailable'}</strong><small>{employee?.employee_code ?? row.employee_id.slice(0, 8)} · {employee?.biomax_user_id ?? 'No BioMax ID'}</small></td>
                    <td>{timeText(row.first_in_at)}</td>
                    <td>{timeText(row.last_out_at)}</td>
                    <td>{row.manual_break_minutes == null ? '—' : row.manual_break_minutes + ' min'}</td>
                    <td>{row.working_minutes == null ? '—' : Math.floor(row.working_minutes / 60) + 'h ' + row.working_minutes % 60 + 'm'}</td>
                    <td>{row.late_minutes == null ? '—' : row.late_minutes + ' min'}</td>
                    <td>{row.early_leave_minutes == null ? '—' : row.early_leave_minutes + ' min'}</td>
                    <td><span className={'pill ' + row.status}>{label(row.status)}</span>{row.issue_codes?.length ? <small>{row.issue_codes.join(', ')}</small> : null}</td>
                    <td><div className="register-actions"><button className="table-action" type="button" onClick={() => onViewPunches(row)}>Punch log</button>{row.first_in_at && row.last_out_at && <button className="table-action" type="button" onClick={() => onRecordManualBreak(row)}>{row.manual_break_minutes == null ? 'Record break' : 'Edit break'}</button>}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !visibleRows.length && <div className="module-empty">No attendance records match the selected dates and filters.</div>}
          {loading && <div className="module-empty">Loading attendance records…</div>}
        </div>
      </section>

      {punchRow && (
        <div className="punch-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClosePunches(); }}>
          <section className="punch-modal" role="dialog" aria-modal="true" aria-labelledby="punch-modal-title">
            <div className="punch-modal-heading">
              <div><span className="module-kicker">IMMUTABLE DEVICE HISTORY</span><h2 id="punch-modal-title">Original BioMax punches</h2><p>{dateText(punchRow.attendance_date)} · {employeeMap.get(punchRow.employee_id)?.full_name ?? 'Employee'}</p></div>
              <button className="icon-close" type="button" onClick={onClosePunches} aria-label="Close punch history">×</button>
            </div>
            <p className="punch-modal-note">This view is read-only. It displays the original device events; corrections are recorded separately and never rewrite these events.</p>
            <div className="table-wrap punch-event-table">
              {punchLoading ? <div className="module-empty">Loading original punches…</div> : punchEvents.length ? (
                <table><thead><tr><th>Time</th><th>BioMax ID</th><th>Raw IN/OUT</th><th>I/O mode</th><th>Verification</th><th>Door mode</th><th>Source</th></tr></thead><tbody>
                  {punchEvents.map((event) => <tr key={event.id}><td>{dateTimeText(event.occurred_at)}</td><td>{event.biomax_user_id}</td><td>{event.raw_in_out ?? 'Not classified'}</td><td>{event.io_mode ?? '—'}</td><td>{event.verify_mode ?? '—'}</td><td>{event.door_mode ?? '—'}</td><td>{label(event.source_channel)}</td></tr>)}
                </tbody></table>
              ) : <div className="module-empty">No raw BioMax events were found for this employee and date.</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
