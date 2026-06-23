. (Join-Path $PSScriptRoot "resolve-node.ps1")

$nodePath = Get-CodexNodePath
& $nodePath (Join-Path $PSScriptRoot "app-health.mjs")
exit $LASTEXITCODE
