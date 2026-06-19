param(
  [Parameter(Mandatory = $true)]
  [string]$Message,

  [switch]$NoPush,

  [switch]$SkipHealth
)

$repoRoot = Split-Path $PSScriptRoot -Parent

if (-not $SkipHealth) {
  Write-Host "Running app health check..."
  & (Join-Path $PSScriptRoot "check-health.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "App health check failed. Commit aborted."
  }
}

function Invoke-GitChecked([string[]]$Arguments) {
  & git -C $repoRoot @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

Invoke-GitChecked @("add", "-A")

$status = & git -C $repoRoot status --short
if ($LASTEXITCODE -ne 0) {
  throw "git status --short failed with exit code $LASTEXITCODE"
}

if (-not $status) {
  Write-Host "No changes to commit."
  exit 0
}

Invoke-GitChecked @("commit", "-m", $Message)

if (-not $NoPush) {
  Invoke-GitChecked @("push", "origin", "main")
}
