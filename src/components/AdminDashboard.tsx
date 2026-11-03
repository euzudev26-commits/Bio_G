import type { ReactNode } from 'react';

type Employee = {
  id: string;
  employee_code: string;
  full_name: string;
  department: string | null;
  designation: string | null;
  employment_status: string;
};

type AttendanceRow = {
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

type CorrectionRequest = {
  id: string;
  employee_id: string;
  attendance_date: string;
  target_punch: string;
  original_time: string | null;
  requested_time: string;
  reason: string;
  status: string;
  submitted_at: string;
  admin_note: string | null;
};

type Device = {
  id: string;
  device_name: string;
  serial_number: string;
  is_active: boolean;
  last_seen_at: string | null;
  site_name: string | null;
  ip_address: string | null;
};

type SyncRun = {
  id: string;
  run_type: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  records_seen: number;
  records_inserted: number;
  records_duplicate: number;
  records_failed: number;
  last_error: string | null;
};

type Props = {
  employees: Employee[];
  rows: AttendanceRow[];
  weeklyRows: AttendanceRow[];
  requests: CorrectionRequest[];
  devices: Device[];
  syncRuns: SyncRun[];
  selectedDate: string;
  lastRefreshed: string | null;
  refreshing: boolean;
  onDateChange: (value: string) => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
};

const indiaDate = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value + 'T00:00:00+05:30'));

const indiaTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';

const indiaDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : 'Not recorded';

const relativeAge = (value: string | null) => {
  if (!value) return 'No communication recorded';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' hr ago';
  return Math.floor(hours / 24) + ' days ago';
};

const shortDay = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(new Date(value + 'T00:00:00+05:30'));

const statusLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function MetricCard({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: string;
  icon: ReactNode;
}) {
  return (
    <article className="dash-metric">
      <div className="dash-metric-top">
        <span className="dash-metric-label">{label}</span>
        <span className={'dash-metric-icon ' + tone}>{icon}</span>
      </div>
      <strong className="dash-metric-value">{value}</strong>
      <span className="dash-metric-detail">{detail}</span>
    </article>
  );
}

export default function AdminDashboard({
  employees,
  rows,
  weeklyRows,
  requests,
  devices,
  syncRuns,
  selectedDate,
  lastRefreshed,
  refreshing,
  onDateChange,
  onRefresh,
  onNavigate,
}: Props) {
  const activeEmployees = employees.filter((employee) => employee.employment_status === 'active');
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const checkedInIds = new Set(rows.filter((row) => row.first_in_at).map((row) => row.employee_id));
  const checkedIn = checkedInIds.size;
  const notRecorded = Math.max(0, activeEmployees.length - checkedIn);
  const present = rows.filter((row) => row.status === 'present').length;
  const incomplete = rows.filter((row) => row.status === 'incomplete').length;
  const pendingDay = rows.filter((row) => row.status === 'pending').length;
  const late = rows.filter((row) => (row.late_minutes ?? 0) > 0).length;
  const pendingRequests = requests.filter((request) => request.status === 'pending');
  const latestRun = syncRuns[0] ?? null;
  const device = devices[0] ?? null;
  const deviceRecentlySeen =
    Boolean(device?.last_seen_at) &&
    Date.now() - new Date(device!.last_seen_at!).getTime() <= 30 * 60 * 1000;

  const trendDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(selectedDate + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - (6 - index));
    const key = day.toISOString().slice(0, 10);
    const dayRows = weeklyRows.filter((row) => row.attendance_date === key);
    return {
      key,
      label: shortDay(key),
      present: dayRows.filter((row) => row.status === 'present').length,
      incomplete: dayRows.filter((row) => row.status === 'incomplete').length,
      pending: dayRows.filter((row) => row.status === 'pending').length,
    };
  });
  const maxTrend = Math.max(
    1,
    ...trendDays.map((day) => day.present + day.incomplete + day.pending),
  );

  const recentRows = [...rows]
    .filter((row) => row.first_in_at)
    .sort((a, b) => new Date(b.first_in_at!).getTime() - new Date(a.first_in_at!).getTime())
    .slice(0, 7);

  return (
    <div className="admin-dashboard">
      <section className="dash-welcome">
        <div>
          <div className="dash-overline">GSONS INDUSTRIES · ADMIN / HR</div>
          <h1>Attendance overview</h1>
          <p>Company attendance at a glance. All times are shown in India Standard Time.</p>
        </div>
        <div className="dash-toolbar">
          <label className="dash-date-control">
            <span>Attendance date</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <button className="dash-refresh" type="button" onClick={onRefresh} disabled={refreshing}>
            <span className={refreshing ? 'dash-refresh-symbol is-spinning' : 'dash-refresh-symbol'}>↻</span>
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </section>

      <div className="dash-freshness">
        <span className="dash-freshness-dot" />
        <span>Connected to Supabase</span>
        <span className="dash-freshness-separator">·</span>
        <span>Updated {lastRefreshed ? relativeAge(lastRefreshed) : 'when data loads'}</span>
        <span className="dash-freshness-separator">·</span>
        <span>Auto-refresh every 60 seconds while this page is open</span>
      </div>

      <section className="dash-metrics" aria-label="Attendance summary">
        <MetricCard
          label="Active employees"
          value={activeEmployees.length}
          detail="In the employee master"
          tone="mint"
          icon={<span>EM</span>}
        />
        <MetricCard
          label="Check-ins recorded"
          value={checkedIn}
          detail={checkedIn + ' of ' + activeEmployees.length + ' active profiles'}
          tone="blue"
          icon={<span>IN</span>}
        />
        <MetricCard
          label="Incomplete days"
          value={incomplete}
          detail="Records requiring punch review"
          tone="amber"
          icon={<span>!</span>}
        />
        <MetricCard
          label="Pending corrections"
          value={pendingRequests.length}
          detail="Awaiting Admin / HR decision"
          tone="rose"
          icon={<span>CR</span>}
        />
      </section>

      <section className="dash-main-grid">
        <article className="dash-panel dash-trend-panel">
          <div className="dash-panel-heading">
            <div>
              <span className="dash-section-kicker">ATTENDANCE ACTIVITY</span>
              <h2>Last 7 days</h2>
              <p>Daily summary records by calculated status</p>
            </div>
            <button className="dash-text-action" type="button" onClick={() => onNavigate('attendance')}>
              View register <span>→</span>
            </button>
          </div>
          <div className="dash-legend">
            <span><i className="legend-present" /> Present</span>
            <span><i className="legend-incomplete" /> Incomplete</span>
            <span><i className="legend-pending" /> Pending</span>
          </div>
          <div className="dash-chart" role="img" aria-label="Daily attendance summary chart for the last seven days">
            {trendDays.map((day) => {
              const total = day.present + day.incomplete + day.pending;
              return (
                <div className="dash-chart-column" key={day.key} title={indiaDate(day.key) + ': ' + total + ' records'}>
                  <div className="dash-chart-bar-area">
                    {total > 0 ? (
                      <div className="dash-chart-stack" style={{ height: (total / maxTrend) * 100 + '%' }}>
                        {day.pending > 0 && <span className="chart-segment segment-pending" style={{ flex: day.pending }} />}
                        {day.incomplete > 0 && <span className="chart-segment segment-incomplete" style={{ flex: day.incomplete }} />}
                        {day.present > 0 && <span className="chart-segment segment-present" style={{ flex: day.present }} />}
                      </div>
                    ) : <span className="dash-chart-empty" />}
                  </div>
                  <strong>{total || '—'}</strong>
                  <small>{day.label}</small>
                </div>
              );
            })}
          </div>
          <div className="dash-chart-note">
            {pendingDay > 0
              ? selectedDate === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
                ? pendingDay + ' current-day record(s) are pending completion; this is not counted as absence.'
                : pendingDay + ' record(s) are pending for the selected date.'
              : 'Only saved attendance summaries are included. Missing summaries are not inferred as absences.'}
          </div>
        </article>

        <article className="dash-panel dash-health-panel">
          <div className="dash-panel-heading">
            <div>
              <span className="dash-section-kicker">BIOMETRIC COLLECTION</span>
              <h2>Device health</h2>
              <p>Registered device and collector activity</p>
            </div>
            <span className="dash-device-status">
              <i className={device?.is_active && deviceRecentlySeen ? 'is-online' : 'is-muted'} />
              {device?.is_active ? (deviceRecentlySeen ? 'Recently seen' : 'No recent contact') : 'Inactive'}
            </span>
          </div>
          {device ? (
            <div className="dash-device-card">
              <div className="dash-device-icon">BM</div>
              <div className="dash-device-info">
                <strong>{device.device_name}</strong>
                <span>{device.serial_number}</span>
                <small>{device.site_name || 'Site not assigned'}{device.ip_address ? ' · ' + device.ip_address : ''}</small>
              </div>
            </div>
          ) : (
            <div className="dash-empty-state">No biometric device is registered.</div>
          )}
          <div className="dash-health-details">
            <div><span>Last device communication</span><strong>{indiaDateTime(device?.last_seen_at ?? null)}</strong><small>{relativeAge(device?.last_seen_at ?? null)}</small></div>
            <div><span>Latest collector run</span><strong>{latestRun ? statusLabel(latestRun.status) : 'No sync yet'}</strong><small>{latestRun ? indiaDateTime(latestRun.completed_at ?? latestRun.started_at) : 'Waiting for first sync'}</small></div>
          </div>
          <button className="dash-outline-action" type="button" onClick={() => onNavigate('devices')}>
            Open device monitoring <span>→</span>
          </button>
        </article>
      </section>

      <section className="dash-lower-grid">
        <article className="dash-panel dash-punch-panel">
          <div className="dash-panel-heading">
            <div>
              <span className="dash-section-kicker">LIVE DATE SNAPSHOT</span>
              <h2>Recent check-ins</h2>
              <p>{indiaDate(selectedDate)} · Latest first punches</p>
            </div>
            <button className="dash-text-action" type="button" onClick={() => onNavigate('attendance')}>
              Full attendance <span>→</span>
            </button>
          </div>
          {recentRows.length > 0 ? (
            <div className="dash-recent-list">
              {recentRows.map((row) => {
                const employee = employeeMap.get(row.employee_id);
                return (
                  <div className="dash-recent-row" key={row.id}>
                    <div className="dash-avatar">{(employee?.full_name || 'E').trim().slice(0, 1).toUpperCase()}</div>
                    <div className="dash-recent-person">
                      <strong>{employee?.full_name ?? 'Employee record'}</strong>
                      <span>{employee?.employee_code ?? 'Code unavailable'}{employee?.department ? ' · ' + employee.department : ''}</span>
                    </div>
                    <div className="dash-recent-time">
                      <strong>{indiaTime(row.first_in_at)}</strong>
                      <span>First IN</span>
                    </div>
                    <span className={'dash-status-pill status-' + row.status}>{statusLabel(row.status)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="dash-empty-state">No check-ins are recorded for this date.</div>
          )}
        </article>

        <article className="dash-panel dash-activity-panel">
          <div className="dash-panel-heading">
            <div>
              <span className="dash-section-kicker">COLLECTOR LOG</span>
              <h2>Recent sync activity</h2>
              <p>Most recent collection attempts</p>
            </div>
          </div>
          {syncRuns.length > 0 ? (
            <div className="dash-sync-list">
              {syncRuns.slice(0, 5).map((run) => (
                <div className="dash-sync-row" key={run.id}>
                  <span className={'dash-sync-mark ' + (run.status === 'completed' ? 'sync-ok' : run.status === 'failed' ? 'sync-failed' : 'sync-other')}>
                    {run.status === 'completed' ? '✓' : run.status === 'failed' ? '!' : '·'}
                  </span>
                  <div className="dash-sync-info">
                    <strong>{statusLabel(run.run_type.replaceAll('_', ' '))}</strong>
                    <span>{indiaDateTime(run.completed_at ?? run.started_at)}</span>
                  </div>
                  <div className="dash-sync-counts">
                    <strong>{run.records_seen}</strong>
                    <span>seen</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="dash-empty-state">No collector runs have been recorded yet.</div>
          )}
          {latestRun?.last_error && <div className="dash-sync-warning">{latestRun.last_error}</div>}
          <button className="dash-outline-action" type="button" onClick={() => onNavigate('devices')}>
            View collection status <span>→</span>
          </button>
        </article>
      </section>

      <section className="dash-bottom-grid">
        <article className="dash-panel dash-attention-panel">
          <div className="dash-panel-heading">
            <div>
              <span className="dash-section-kicker">WORK QUEUE</span>
              <h2>Needs attention</h2>
              <p>Items requiring an Admin / HR review</p>
            </div>
          </div>
          <button className="dash-queue-item" type="button" onClick={() => onNavigate('requests')}>
            <span className="dash-queue-icon queue-correction">CR</span>
            <span><strong>Correction requests</strong><small>Employee-submitted changes awaiting a decision</small></span>
            <b>{pendingRequests.length}</b>
            <span className="dash-queue-arrow">→</span>
          </button>
          <button className="dash-queue-item" type="button" onClick={() => onNavigate('attendance')}>
            <span className="dash-queue-icon queue-incomplete">!</span>
            <span><strong>Incomplete attendance</strong><small>Saved days with an incomplete punch pattern</small></span>
            <b>{incomplete}</b>
            <span className="dash-queue-arrow">→</span>
          </button>
          <button className="dash-queue-item" type="button" onClick={() => onNavigate('attendance')}>
            <span className="dash-queue-icon queue-late">LT</span>
            <span><strong>Late arrivals</strong><small>Selected date, based on assigned shift policy</small></span>
            <b>{late}</b>
            <span className="dash-queue-arrow">→</span>
          </button>
        </article>

        <article className="dash-panel dash-coverage-panel">
          <div className="dash-panel-heading">
            <div>
              <span className="dash-section-kicker">DAILY COVERAGE</span>
              <h2>Check-in coverage</h2>
              <p>Employee profiles with a first IN on {indiaDate(selectedDate)}</p>
            </div>
          </div>
          <div className="dash-coverage-number">
            <strong>{checkedIn}</strong><span> / {activeEmployees.length} active employees</span>
          </div>
          <div className="dash-coverage-track">
            <span style={{ width: (activeEmployees.length ? Math.min(100, (checkedIn / activeEmployees.length) * 100) : 0) + '%' }} />
          </div>
          <div className="dash-coverage-breakdown">
            <div><i className="coverage-checked" /><span>Check-in recorded</span><strong>{checkedIn}</strong></div>
            <div><i className="coverage-missing" /><span>No check-in recorded</span><strong>{notRecorded}</strong></div>
          </div>
          <p className="dash-coverage-note">“No check-in recorded” is an informational count only. It is not an absence or leave decision.</p>
        </article>
      </section>
    </div>
  );
}
