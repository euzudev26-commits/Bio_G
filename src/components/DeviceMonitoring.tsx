export type DeviceRecord = {
  id: string;
  device_name: string;
  serial_number: string;
  is_active: boolean;
  last_seen_at: string | null;
  site_name: string | null;
  ip_address: string | null;
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

export default function DeviceMonitoring({ devices, syncRuns, refreshing, onRefresh }: Props) {
  const now = Date.now();
  const active = devices.filter((device) => device.is_active).length;
  const recentlySeen = devices.filter((device) =>
    device.is_active && device.last_seen_at && now - new Date(device.last_seen_at).getTime() <= 30 * 60 * 1000,
  ).length;
  const failures = syncRuns.filter((run) => run.status === 'failed' || run.records_failed > 0).length;

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
