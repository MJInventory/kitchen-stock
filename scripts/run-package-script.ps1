param(
  [Parameter(Mandatory = $true)]
  [string]$Name
)

& (Join-Path $PSScriptRoot "run-npm.ps1") "run" $Name
exit $LASTEXITCODE
