param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$NpmArgs
)

. (Join-Path $PSScriptRoot "resolve-node.ps1")
. (Join-Path $PSScriptRoot "resolve-pnpm.ps1")

$nodePath = Get-CodexNodePath
$pnpmPath = Get-CodexPnpmPath
$nodeBin = Split-Path $nodePath -Parent
$toolBin = Split-Path $pnpmPath -Parent

foreach ($segment in @($nodeBin, $toolBin)) {
  if ($env:PATH -notlike "*$segment*") {
    $env:PATH = "$segment;$env:PATH"
  }
}

$realNpm = Get-Command npm,npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
if ($realNpm -and $realNpm.Source) {
  & $realNpm.Source @NpmArgs
  exit $LASTEXITCODE
}

$repoRoot = Split-Path $PSScriptRoot -Parent
$packagePath = Join-Path $repoRoot "package.json"
$packageScripts = @()

if (Test-Path $packagePath) {
  $package = Get-Content $packagePath -Raw | ConvertFrom-Json
  if ($package.scripts) {
    $packageScripts = $package.scripts.PSObject.Properties.Name
  }
}

$mappedArgs = @()
if (-not $NpmArgs -or $NpmArgs.Count -eq 0) {
  $mappedArgs = @("--version")
} elseif ($NpmArgs[0] -eq "run" -and $NpmArgs.Count -ge 2) {
  $mappedArgs = @("run") + $NpmArgs[1..($NpmArgs.Count - 1)]
} elseif ($NpmArgs[0] -eq "install") {
  $mappedArgs = @("install", "--lockfile=false")
  if ($NpmArgs.Count -gt 1) {
    $mappedArgs += $NpmArgs[1..($NpmArgs.Count - 1)]
  }
} elseif ($NpmArgs[0] -eq "ci") {
  $mappedArgs = @("install", "--frozen-lockfile", "--lockfile=false")
  if ($NpmArgs.Count -gt 1) {
    $mappedArgs += $NpmArgs[1..($NpmArgs.Count - 1)]
  }
} elseif ($packageScripts -contains $NpmArgs[0]) {
  $mappedArgs = @("run") + $NpmArgs
} else {
  $mappedArgs = $NpmArgs
}

& $pnpmPath @mappedArgs
exit $LASTEXITCODE
