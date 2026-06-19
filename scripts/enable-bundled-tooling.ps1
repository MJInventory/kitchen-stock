. (Join-Path $PSScriptRoot "resolve-node.ps1")
. (Join-Path $PSScriptRoot "resolve-pnpm.ps1")

$nodePath = Get-CodexNodePath
$pnpmPath = Get-CodexPnpmPath
$toolBin = Split-Path $pnpmPath -Parent
$nodeBin = Split-Path $nodePath -Parent

foreach ($segment in @($toolBin, $nodeBin)) {
  if ($env:PATH -notlike "*$segment*") {
    $env:PATH = "$segment;$env:PATH"
  }
}

function global:npm {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )

  & (Join-Path $PSScriptRoot "run-npm.ps1") @Args
}

Write-Host "Bundled Node tooling enabled for this PowerShell session."
Write-Host "node => $nodePath"
Write-Host "pnpm => $pnpmPath"
Write-Host "npm => wrapper function backed by local npm or bundled pnpm"
