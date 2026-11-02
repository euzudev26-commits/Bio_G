# BioMax Windows collector

The Windows package is distributed as a companion ZIP and runs on a Windows PC on the same office LAN as the BioMax device.

## Device configured

- Name: `HO_GSONS`
- Model: `N-MULTIBIO900 / Multibio 900`
- Serial: `AMDB25093800050`
- IP: `192.168.1.241`
- TCP port: `5005`
- Protocol ID: `0x18181818`
- Time zone: `Asia/Kolkata`

## Verified so far

- Physical `GetDeviceInfo` TCP test passed from the office Windows PC on 2 November 2026.
- The device returned `allLogCount = 8396` and `userCount = 39`.
- A date-filtered `GetLogDataPage` read for `2026-11-01` returned `allLogCount = 0` and zero events. This establishes only that no events were returned for that one-day filter; it does not mean the device has no attendance history.
- No punch records have been uploaded and no device settings/logs have been modified.

## Next read-only step

Run `DRY-RUN-ALL-HISTORY.bat`. It requests `2010-01-01 00:00:00` through `2026-11-02 23:59:59` with `GetLogDataPage`. It saves pages and generates the punches CSV, per-user count CSV, and JSON summary locally. It does not upload anything.

Review `count_matches_device_report`, the total event count, timestamp range, and BioMax user IDs. Do not upload until the result has been checked against the machine. If the broad query still returns zero, stop and inspect the raw response/command date format with the vendor SDK; do not alter device settings or try clear/reset commands.

## Employee mapping before uploads

The database's `public.employees` table currently has no employee rows. Fill `employee_biomax_template.csv` with each employee's official employee code, exact BioMax user ID (keep as text to preserve leading zeroes), and full name. Then import it into `public.employees` and verify mappings before sending punch batches.

## Security and safety

- Keep `collector.private.json` local to the collector PC and outside Git. It contains the device-scoped ingestion token.
- Never put a Supabase secret/service-role key in the collector or browser.
- The `biomax-ingest` Edge Function validates the device-scoped token and deduplicates by event fingerprint.
- No `ClearLogData`, `ResetDevice`, user-enrolment or other destructive command is used.
- `inOut` and numeric/bitmask `ioMode` values are stored as raw values pending device-specific confirmation.
- Raw punch import alone does not populate `attendance_daily_summaries`; the attendance processor and shift rules are still required.
