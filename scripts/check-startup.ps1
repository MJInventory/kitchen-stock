. (Join-Path $PSScriptRoot "resolve-node.ps1")

$node = Get-CodexNodePath
& $node (Join-Path $PSScriptRoot "check-startup.mjs")
exit $LASTEXITCODE
