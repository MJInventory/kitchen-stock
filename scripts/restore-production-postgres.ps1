param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$PgRestorePath = "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe",
  [switch]$DropExistingObjects,
  [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PgRestorePath)) {
  throw "pg_restore not found at '$PgRestorePath'. Update -PgRestorePath to your PostgreSQL bin path."
}

if (-not (Test-Path -LiteralPath $BackupFile)) {
  throw "Backup file not found at '$BackupFile'."
}

$restoreArgs = @(
  "--verbose",
  "--no-owner",
  "--no-privileges",
  "--clean",
  "--if-exists"
)

if (-not $DropExistingObjects) {
  Write-Warning "You did not pass -DropExistingObjects. The restore will still use --clean/--if-exists for objects in the dump."
}

$restoreArgs += "--dbname=$DatabaseUrl"
$restoreArgs += $BackupFile

Write-Host "Restore command prepared:"
Write-Host "`"$PgRestorePath`" $($restoreArgs -join ' ')"

if ($WhatIfOnly) {
  Write-Host "WhatIfOnly set. No restore executed."
  exit 0
}

Write-Warning "This will restore the database from the selected dump file."
$confirmation = Read-Host "Type RESTORE to continue"
if ($confirmation -cne "RESTORE") {
  throw "Restore cancelled."
}

& $PgRestorePath @restoreArgs

Write-Host "Restore complete."
