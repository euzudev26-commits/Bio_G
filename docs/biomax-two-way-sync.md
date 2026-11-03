# GSONS BioMax two-way synchronization — phase 1 foundation

## Device identity
- Model: N-MULTIBIO900 / Multibio 900
- Serial: AMDB25093800050
- Firmware: K8D_3Y3Kbio030_3.2
- Local TCP endpoint used by collector: 192.168.1.241:5005
- Existing real-time destination: Indigo at 192.168.20.252:8092

## Supported data boundary
The current TCP collector interface has been verified for GetDeviceInfo and GetLogDataPage only. The vendor PUSH SDK uses a separate HTTP polling/command-response transport.

The published PUSH SDK documents USERINFO add/update fields PIN, Name and Pri. It also documents user deletion, which may remove fingerprint/face templates. This phase queues only a non-destructive USERINFO upsert. It does not automatically change PIN or delete a device user. GSONS-only fields (employee code, department, designation, email, phone, joining date and employment status) are identified in queue metadata and are not sent as device fields.

The documented attendance-log command set includes query and whole-log clear, but no individual ATTLOG update. A GSONS-approved attendance correction therefore remains active in the GSONS adjustment ledger and is shown as blocked for device write. Do not use whole-log clear for a single correction.

## Database and API foundation
- device_sync_jobs is a protected, Admin-readable outbox.
- Employee changes produce an auditable upsert_userinfo job.
- Inbound employee identity import updates only BioMax ID and display name and writes an audit entry. A sync-origin flag prevents echoing imported changes back to the outbound queue.
- claim_device_sync_jobs leases work to a trusted service-role collector.
- finish_device_sync_job only completes a job after the collector reports the result.
- biomax-device-sync validates the existing device-scoped collector token and exposes heartbeat, claim_jobs, finish_job and import_employee actions.

## Not yet active end-to-end
The existing Windows collector V1.1.2 currently performs historical polling / ingestion only; it does not yet claim device_sync_jobs or implement the separate PUSH HTTP command channel. Therefore the outbox is active in Supabase, but employee changes are not yet being sent to the physical terminal. The installed Indigo real-time destination has not been changed.
