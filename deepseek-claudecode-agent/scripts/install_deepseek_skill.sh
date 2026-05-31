#!/bin/bash
# Install deepseek-claudecode-agent skill on Linux/macOS
set -e
SKILL_NAME="deepseek-claudecode-agent"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SKILLS_DIR="$CODEX_HOME/skills/$SKILL_NAME"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Installing $SKILL_NAME to $SKILLS_DIR..."

mkdir -p "$SKILLS_DIR"
for f in SKILL.md manifest.json; do
    [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$SKILLS_DIR/"
done
for d in scripts references agents; do
    [ -d "$SRC_DIR/$d" ] && cp -r "$SRC_DIR/$d" "$SKILLS_DIR/"
done

echo "Running doctor..."
python3 "$SKILLS_DIR/scripts/doctor_deepseek_claudecode.py" || echo "⚠ Doctor found issues. Review and fix before use."

echo "✓ Installed. Set DEEPSEEK_API_KEY and CLAUDECODE_DEEPSEEK_CMD env vars."
