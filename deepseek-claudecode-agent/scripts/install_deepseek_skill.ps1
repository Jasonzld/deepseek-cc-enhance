# Install deepseek-claudecode-agent skill on Windows
param([switch]$DryRun)
$ErrorActionPreference = "Stop"
$SKILL_NAME = "deepseek-claudecode-agent"
$CODEX_HOME = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { "$env:USERPROFILE\.codex" }
$SKILLS_DIR = "$CODEX_HOME\skills\$SKILL_NAME"
$SRC_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

Write-Host "Installing $SKILL_NAME to $SKILLS_DIR..."

if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $SKILLS_DIR | Out-Null
    foreach ($f in @("SKILL.md", "manifest.json")) {
        if (Test-Path "$SRC_DIR\$f") { Copy-Item "$SRC_DIR\$f" "$SKILLS_DIR\" }
    }
    foreach ($d in @("scripts", "references", "agents")) {
        if (Test-Path "$SRC_DIR\$d") { Copy-Item -Recurse -Force "$SRC_DIR\$d" "$SKILLS_DIR\" }
    }
    Write-Host "Running doctor..."
    python "$SKILLS_DIR\scripts\doctor_deepseek_claudecode.py"
    if ($LASTEXITCODE -ne 0) { Write-Host "⚠ Doctor found issues. Review before use." }
} else {
    Write-Host "[DRY-RUN] Would copy from $SRC_DIR to $SKILLS_DIR"
}

Write-Host "✓ Done. Set `$env:DEEPSEEK_API_KEY and `$env:CLAUDECODE_DEEPSEEK_CMD."
