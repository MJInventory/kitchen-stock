param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$NodeArgs
)

. (Join-Path $PSScriptRoot "resolve-node.ps1")

$node = Get-CodexNodePath
& $node @NodeArgs
exit $LASTEXITCODE
