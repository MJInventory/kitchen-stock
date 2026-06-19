function Get-CodexPnpmPath {
  $command = Get-Command pnpm,pnpm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command -and $command.Source) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\openai-primary-runtime\dependencies\bin\pnpm.cmd")
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  throw "pnpm executable not found on PATH or in the bundled Codex runtime cache."
}

if ($MyInvocation.InvocationName -ne ".") {
  Write-Output (Get-CodexPnpmPath)
}
