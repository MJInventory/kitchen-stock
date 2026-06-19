function Get-CodexNodePath {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\openai-primary-runtime\dependencies\node\bin\node.exe")
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  throw "Node.js executable not found on PATH or in the bundled Codex runtime cache."
}

if ($MyInvocation.InvocationName -ne ".") {
  Write-Output (Get-CodexNodePath)
}
