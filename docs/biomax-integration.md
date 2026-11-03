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


## Two-way synchronization foundation (2026-11-03)

The current registered device is the N-MULTIBIO900 / Multibio 900, serial `AMDB25093800050`, firmware `K8D_3Y3Kbio030_3.2`, TCP `192.168.1.241:5005`. Existing Indigo event destination is preserved.

The new database outbox records employee inserts and changes to name or BioMax ID as `upsert_userinfo` jobs. It only includes verified USERINFO fields `PIN`, `Name` and normal-user privilege. GSONS-only fields (employee code, department, designation, email, phone, joining date, employment status) are not misrepresented as device fields.

A server-side collector API is available at `biomax-device-sync` for token-authenticated heartbeat, job claim/finish and basic inbound employee identity import. The Windows collector currently installed does not yet call this API or execute outbound jobs.

**Transport separation:** the existing raw TCP JSON API on port 5005 is verified for `GetDeviceInfo` and `GetLogDataPage`. The PUSH SDK uses a separate HTTP device-poll/command-reply channel. Do not send a PUSH command string over the raw TCP socket or change the configured Indigo destination to test it.

**Attendance correction boundary:** GSONS retains the original punch in `raw_punch_events` and approved changes in `attendance_adjustments`. The reviewed PUSH command set has attendance-log query and whole-log clear operations but no individual ATTLOG update. A correction is therefore visible as a blocked device-sync job and is not reported as written to BioMax.
