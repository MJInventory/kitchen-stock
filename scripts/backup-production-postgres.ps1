param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$OutputDir = "C:\Users\hello\Documents\New project\kitchen-stock-fresh\backups",
  [string]$PgDumpPath = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
  throw "DATABASE_URL is not set. Pass -DatabaseUrl or set the environment variable first."
}

if (-not (Test-Path -LiteralPath $PgDumpPath)) {
  throw "pg_dump not found at '$PgDumpPath'. Update -PgDumpPath to your PostgreSQL bin path."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "production-postgres-$timestamp.dump"
$outputPath = Join-Path $OutputDir $fileName

Write-Host "Creating PostgreSQL backup at $outputPath"

& $PgDumpPath `
  --format=custom `
  --verbose `
  --no-owner `
  --no-privileges `
  --file=$outputPath `
  $DatabaseUrl

if (-not (Test-Path -LiteralPath $outputPath)) {
  throw "Backup failed. Output file was not created."
}

$file = Get-Item -LiteralPath $outputPath
Write-Host "Backup complete."
Write-Host "File: $($file.FullName)"
Write-Host "Size: $([math]::Round($file.Length / 1MB, 2)) MB"
