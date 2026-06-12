# Installs the Fixor git pre-commit hook (secrets scan on staged files).
# Run once per clone:  powershell -ExecutionPolicy Bypass -File scripts\install_hooks.ps1
$repoRoot = Split-Path -Parent $PSScriptRoot
$hookPath = Join-Path $repoRoot ".git\hooks\pre-commit"
$hook = @'
#!/bin/sh
python scripts/secrets_scan.py --staged || {
  echo ""
  echo "Commit blocked: potential secret in staged files. Move it to .env / the host env store."
  exit 1
}
'@
Set-Content -Path $hookPath -Value $hook -Encoding ascii -NoNewline
Write-Host "pre-commit hook installed at $hookPath"
