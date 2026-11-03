# BioMax integration — verified facts and collector requirements

## Known device

- Device name: `HO_GSONS`
- Model: `N-MULTIBIO900` / Multibio 900
- Serial / Cloud ID: `AMDB25093800050`
- Firmware: `K8D_3Y3Kbio030_3.2`
- IP observed: `192.168.1.241`
- Historical local web command: `GetLogDataPage`
- Historical request shape: `cmd=GetLogDataPage`, `data={beginTime,endTime,page,pageCount}`

## Verified real-time event

A normal punch was captured as an HTTP request to the Indigo collector:

```http
POST /AIData.aspx HTTP/1.0
Content-Type: application/json
request_code: realtime_glog
trans_id: RTLogSend
```

Payload fields observed:

- `userId`
- `time` (`YYYYMMDDHHMMSS`)
- `inOut`
- `ioMode`
- `verifyMode`
- `doorMode`
- `logPhoto` (Base64 JPEG)

Indigo returned HTTP 200 and `response_code: OK` for the observed event. The token header is intentionally not stored in this source tree.

## Collector design requirements

1. Run as a Windows Service on a continuously available office PC/server.
2. Receive and parse real-time device pushes without modifying the BioMax event.
3. Keep an exact source timestamp and the `Asia/Kolkata` interpretation.
4. Store the raw event in `raw_punch_events`; the database trigger removes the `logPhoto` property from JSONB.
5. If punch photos are retained, upload them separately to a private Storage bucket and store only a private object path and SHA-256 hash in the database.
6. Use an idempotent `event_fingerprint` to make retries safe.
7. Keep a durable queue/retry log; never acknowledge an event until it is safely persisted and/or forwarded according to the deployment design.
8. Keep historical import (`GetLogDataPage`) separate from real-time intake and reconcile overlaps by fingerprint.
9. Continue forwarding events to Indigo during the transition only after the relay behavior is implemented and tested safely. Do not replay old captured POSTs.
10. Never call destructive commands such as `ClearLogData` or `ResetDevice`.

## Not yet implemented

The Windows collector, local queue, historical-import worker, event deduplication code and reconciliation processor are still to be built and tested. The device has not been reconfigured as part of this database setup.


## V1.1 rolling collector — 3 November 2026

A separately packaged Windows polling collector is prepared as `GSONS-BioMax-Collector-v1.1.0.zip`. It polls a rolling overlap (default: the previous seven days plus today) every five minutes, writes a local durable outbox, uploads through `biomax-ingest`, and sends a heartbeat to update `attendance_devices.last_seen_at`.

The polling path uses only `GetDeviceInfo` and `GetLogDataPage` read commands. It does not bind a local inbound listener and does not change the BioMax Server IP/Port configuration. The currently configured Indigo destination remains unchanged.

The `biomax-ingest` function V2 adds:
- `source_channel = reconciliation`, recorded as `collector_sync_runs.run_type = reconciliation`.
- A token-authenticated heartbeat request that updates device/token last-seen fields without inserting an artificial punch or a sync-run row.
- Strict partial-batch acknowledgement: payloads with rejected events return HTTP 422 and `ok=false`; collector queue files therefore remain pending for safe retry.

A read-only test on 3 November 2026 fetched 62 events for 2–3 November from the device, across three pages, matching the device-reported count. No upload was performed by that test. The scheduled collector must still be installed and its first live sync verified on the office Windows PC. Do not claim continuous sync is active until that verification succeeds.
