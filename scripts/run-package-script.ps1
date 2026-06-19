param(
  [Parameter(Mandatory = $true)]
  [string]$Name
)

. (Join-Path $PSScriptRoot "resolve-node.ps1")

$repoRoot = Split-Path $PSScriptRoot -Parent
$packagePath = Join-Path $repoRoot "package.json"

if (-not (Test-Path $packagePath)) {
  throw "package.json not found at $packagePath"
}

$package = Get-Content $packagePath -Raw | ConvertFrom-Json
$scripts = $package.scripts

if (-not $scripts -or -not $scripts.PSObject.Properties.Name.Contains($Name)) {
  throw "Package script '$Name' was not found."
}

$scriptCommand = [string]$scripts.$Name
$node = Get-CodexNodePath

if ($scriptCommand -match '^\s*node\s+(.+?)\s*$') {
  $target = $Matches[1].Trim()
  & $node $target
  exit $LASTEXITCODE
}

throw "Package script '$Name' is not a direct node command and cannot be run through the PowerShell wrapper yet: $scriptCommand"
