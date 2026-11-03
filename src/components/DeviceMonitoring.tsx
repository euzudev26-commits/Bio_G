export type DeviceRecord = {
  id: string;
  device_name: string;
  serial_number: string;
  is_active: boolean;
  last_seen_at: string | null;
  site_name: string | null;
  ip_address: string | null;
};

export type DeviceSyncJobRecord = {
  id: string; device_id: string | null; direction: string; entity_type: string; entity_id: string | null;
  operation: string; status: string; payload: Record<string, unknown> | null; attempt_count: number;
  last_error: string | null; created_at: string; updated_at: string; completed_at: string | null;
};

export type SyncRunRecord = {
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
  devices: DeviceRecord[];
  syncRuns: SyncRunRecord[];
  jobs: DeviceSyncJobRecord[];
  refreshing: boolean;
  onRefresh: () => void;
};

const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : 'Not recorded';

const age = (value: string | null) => {
  if (!value) return 'No communication recorded';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + ' minutes ago';
  if (minutes < 1440) return Math.floor(minutes / 60) + ' hours ago';
  return Math.floor(minutes / 1440) + ' days ago';
};

const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function DeviceMonitoring({ devices, syncRuns, jobs, refreshing, onRefresh }: Props) {
  const now = Date.now();
  const active = devices.filter((device) => device.is_active).length;
  const recentlySeen = devices.filter((device) =>
    device.is_active && device.last_seen_at && now - new Date(device.last_seen_at).getTime() <= 30 * 60 * 1000,
  ).length;
  const failures = syncRuns.filter((run) => run.status === 'failed' || run.records_failed > 0).length;
  const waitingJobs = jobs.filter((job) => job.direction === 'to_device' && (job.status === 'pending' || job.status === 'failed')).length;
  const blockedJobs = jobs.filter((job) => job.status === 'blocked').length;
  const completedJobs = jobs.filter((job) => job.status === 'completed').length;

  return (
    <div className="device-monitoring">
      <section className="module-heading">
        <div>
          <span className="module-kicker">BIOMETRIC INFRASTRUCTURE</span>
          <h1>Device monitoring</h1>
          <p>Registered BioMax devices, last communication and collector synchronization history.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh status'}</button>
      </section>

      <section className="device-summary">
        <div><span>Registered devices</span><strong>{devices.length}</strong></div>
        <div><span>Active devices</span><strong>{active}</strong></div>
        <div><span>Seen in last 30 minutes</span><strong>{recentlySeen}</strong></div>
        <div><span>Recent runs needing review</span><strong>{failures}</strong></div>
      </section>

      <section className="panel device-sync-queue">
        <div className="module-subheading">
          <div><span className="module-kicker">TWO-WAY SYNC CONTROL</span><h2>BioMax synchronization queue</h2><p>Audited employee updates and attendance adjustments destined for device-side handling.</p></div>
        </div>
        <div className="device-sync-explainer">
          <strong>Outbound command worker not yet installed</strong>
          <p>The existing Windows collector V1.1.2 imports punches using the BioMax TCP 5005 interface. It does not yet claim or execute outbound USERINFO jobs. Pending jobs are safely queued in Supabase; none are marked synchronized until the device acknowledges a supported command.</p>
          <p><b>Supported field scope:</b> BioMax user ID (PIN), display name and standard user privilege. Department, designation, email, phone, joining date and employment status remain GSONS-only.</p>
        </div>
        <div className="device-sync-queue-metrics">
          <div><span>Awaiting collector</span><strong>{waitingJobs}</strong></div>
          <div><span>Blocked / manual review</span><strong>{blockedJobs}</strong></div>
          <div><span>Device acknowledged</span><strong>{completedJobs}</strong></div>
          <div><span>Recent jobs shown</span><strong>{jobs.length}</strong></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Created</th><th>Direction</th><th>Entity</th><th>Operation</th><th>Status</th><th>Attempts</th><th>Details</th></tr></thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{dateTime(job.created_at)}</td>
                  <td>{label(job.direction)}</td>
                  <td>{label(job.entity_type)}</td>
                  <td>{label(job.operation)}</td>
                  <td><span className={'sync-job-state sync-job-' + job.status}>{label(job.status)}</span></td>
                  <td>{job.attempt_count}</td>
                  <td>{job.last_error || (job.status === 'pending' ? 'Queued; awaiting command-capable collector' : job.status === 'completed' ? 'Device acknowledgement recorded' : job.status === 'processing' ? 'Collector has claimed this job' : 'No additional details')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!jobs.length && <div className="module-empty">No employee or attendance synchronization jobs have been generated yet.</div>}
        </div>
        <p className="module-footnote">Approved attendance corrections are never written over the original BioMax punch. The published PUSH SDK does not document an individual ATTLOG update command; these items remain blocked in this queue and the approved adjustment continues to be used by GSONS attendance calculations.</p>
      </section>

      <section className="device-card-grid">
        {devices.map((device) => {
          const online = Boolean(device.is_active && device.last_seen_at && now - new Date(device.last_seen_at).getTime() <= 30 * 60 * 1000);
          return (
            <article className="panel device-card" key={device.id}>
              <div className="device-card-top">
                <div className="device-symbol">BM</div>
                <span className={'device-online-chip ' + (online ? 'device-online' : device.is_active ? 'device-stale' : 'device-inactive')}>
                  <i />{!device.is_active ? 'Inactive' : online ? 'Recently seen' : 'No recent contact'}
                </span>
              </div>
              <h2>{device.device_name}</h2>
              <p className="device-serial">{device.serial_number}</p>
              <div className="device-meta-grid">
                <div><span>Site</span><strong>{device.site_name || 'Not assigned'}</strong></div>
                <div><span>Local IP address</span><strong>{device.ip_address || 'Not recorded'}</strong></div>
                <div><span>Last communication</span><strong>{dateTime(device.last_seen_at)}</strong><small>{age(device.last_seen_at)}</small></div>
              </div>
              <p className="device-caveat">“Recently seen” is based on the last timestamp received by Supabase. It is not a continuous network ping to the device.</p>
            </article>
          );
        })}
        {!devices.length && <div className="panel module-empty">No biometric devices are registered yet.</div>}
      </section>

      <section className="panel device-sync-panel">
        <div className="module-subheading"><div><span className="module-kicker">COLLECTOR HISTORY</span><h2>Recent synchronization runs</h2><p>Latest 25 collector sync records stored by the backend.</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Started</th><th>Type</th><th>Status</th><th>Seen</th><th>Inserted</th><th>Duplicates</th><th>Failed</th><th>Details</th></tr></thead>
            <tbody>
              {syncRuns.map((run) => (
                <tr key={run.id}>
                  <td>{dateTime(run.started_at)}</td>
                  <td>{label(run.run_type)}</td>
                  <td><span className={'pill ' + (run.status === 'completed' ? 'approved' : run.status === 'failed' ? 'rejected' : 'pending')}>{label(run.status)}</span></td>
                  <td>{run.records_seen}</td>
                  <td>{run.records_inserted}</td>
                  <td>{run.records_duplicate}</td>
                  <td>{run.records_failed}</td>
                  <td>{run.last_error || (run.completed_at ? 'Completed ' + dateTime(run.completed_at) : 'Still running')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!syncRuns.length && <div className="module-empty">No collector activity has been recorded.</div>}
        </div>
      </section>
      <p className="module-footnote">The page displays recorded collector/device signals. It does not send a network command to BioMax or restart the Windows collector.</p>
    </div>
  );
}
