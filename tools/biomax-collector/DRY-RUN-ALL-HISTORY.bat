@echo off
cd /d "%~dp0"
echo GSONS BioMax full-history dry-run
echo Device: HO_GSONS (192.168.1.241)
echo Date: 2010-01-01 through 2026-11-02 (Asia/Kolkata)
echo.
echo Read-only operation: no upload, no device setting change, no log clearing.
echo.
py -3 biomax_collector.py import --from 2010-01-01 --to 2026-11-02 --dry-run
if errorlevel 1 (
  echo.
  echo Historical dry-run failed. Review logs\collector.log.
) else (
  echo.
  echo DRY-RUN COMPLETE: no records were uploaded.
  echo Review reports\historical_20100101_20261102_summary.json
  echo Review reports\historical_20100101_20261102_punches.csv
  echo Review reports\historical_20100101_20261102_user_counts.csv
  echo Do not import until the report is reviewed.
)
echo.
pause
