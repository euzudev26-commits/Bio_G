# BioMax Windows collector

The separate Windows package is delivered as `GSONS-BioMax-Collector.zip`. It is intentionally separate from the Vercel web app: the collector runs on a Windows computer on the same office LAN as the BioMax attendance device.

## Supported first milestone

- Read-only `GetDeviceInfo` connection check.
- Read-only, paginated `GetLogDataPage` historical import.
- Local durable pending queue before upload.
- Secure upload to the `biomax-ingest` Supabase Edge Function using a device-scoped token.
- Idempotent raw-punch insertion and duplicate accounting.
- Retry of unacknowledged local batches.

The collector source and two protocol tests are included in the companion ZIP. Run `python -m unittest discover -s tests -v` to run its protocol simulator tests.

## Device configuration

The initial values are the previously observed GSONS BioMax device:

- `HO_GSONS`
- Model `N-MULTIBIO900 / Multibio 900`
- Serial `AMDB25093800050`
- IP `192.168.1.241`
- TCP port `5005`
- Protocol ID `0x18181818` (verify against the installed vendor SDK if the first connection test reports a mismatch)

The port and protocol ID are configurable. A read-only connection test must pass before any historical import is attempted.

## First run

1. Extract the ZIP on a Windows PC connected to the same LAN.
2. Run `TEST-CONNECTION.bat`.
3. Prepare the employee master and exact `biomax_user_id` mapping in `employee_biomax_template.csv`.
4. Import employee rows into `public.employees` using the Supabase Table Editor or a controlled import.
5. Run `DRY-RUN-HISTORICAL.bat` for one completed day and compare the returned rows with the device display.
6. Only after validating the dry-run, run `IMPORT-HISTORICAL.bat` for that date.
7. Use `UPLOAD-PENDING.bat` to retry queued batches after a network interruption.

## Security

- The live collector token is stored only in the ZIP's local `collector.private.json`; that file is excluded from source control.
- Never commit the real token, a Supabase service/secret key, or the local pending queue.
- The Edge Function `biomax-ingest` uses custom device-token validation; `verify_jwt = false` is intentional for this machine-to-machine route.
- The device's destination settings are not changed by the first historical import.
- Do not invoke `ClearLogData`, `ResetDevice`, or any device command that mutates attendance records.
- Numeric/bitmask `ioMode`/direction values remain raw until confirmed on this specific device. Do not derive IN/OUT status from unverified values.

## Current boundary

The historical collector package is built, but it has only been tested against a simulated TCP device. It has not yet been run from the office Windows network against the physical BioMax. The attendance calculation engine and shift/holiday rules remain a follow-up task; importing raw punches alone does not populate `attendance_daily_summaries`.
