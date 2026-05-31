#!/usr/bin/env python3
"""Self-healing diagnostic for DeepSeek ClaudeCode Agent skill.
Checks: Python, env, command, files, redaction, smoke prompt.
Exit 0 = healthy, non-zero = issues found.
"""

import os, sys, subprocess, json, re, shutil
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
SECRET_PATTERNS = [re.compile(r'sk-[a-zA-Z0-9]{32,}'), re.compile(r'apiKey["\s:=]+[a-zA-Z0-9_-]{20,}')]
issues = []

def check(name, condition, detail=""):
    if not condition:
        issues.append(f"{name}: {detail}" if detail else name)
    return condition

def scan_secrets(text, label):
    for pat in SECRET_PATTERNS:
        if pat.search(text or ""):
            issues.append(f"SECRET LEAK in {label}: matches pattern {pat.pattern[:20]}...")
            return True
    return False

# 1. Python
check("python>=3.8", sys.version_info >= (3, 8), f"Python {sys.version}")

# 2. Required env vars (existence only, never print values)
for var in ["DEEPSEEK_API_KEY", "CLAUDECODE_DEEPSEEK_CMD"]:
    if not check(f"env:{var}", var in os.environ, f"${var} not set"):
        continue
    val = os.environ[var]
    if scan_secrets(val, f"env:{var}"):
        print(f"  WARNING: {var} value looks like it contains a secret in the command template. Move it to a dedicated env var.")

# 3. ClaudeCode command resolves
cmd_template = os.environ.get("CLAUDECODE_DEEPSEEK_CMD", "")
if cmd_template and "{model}" in cmd_template:
    test_cmd = cmd_template.replace("{model}", "deepseek-v4-pro").split()[0]
    if not shutil.which(test_cmd):
        issues.append(f"command not found: {test_cmd}")

# 4. Required skill files
required = ["SKILL.md", "scripts/run_deepseek_claudecode.py", "agents/openai.yaml"]
for f in required:
    check(f"file:{f}", (SKILL_ROOT / f).exists())

# 5. References
refs_dir = SKILL_ROOT / "references"
if refs_dir.exists():
    for ref in refs_dir.glob("*.md"):
        content = ref.read_text(encoding="utf-8", errors="ignore")
        scan_secrets(content, f"reference:{ref.name}")

# 6. Quick smoke (optional, only if env is healthy)
if not issues and os.environ.get("DEEPSEEK_API_KEY"):
    smoke_prompt = "You are testing the DeepSeek ClaudeCode wrapper. Reply with: model identity if available, current task summary, no secrets received, one suggested local verification command. Do not invent file contents."
    try:
        result = subprocess.run(
            cmd_template.replace("{model}", "deepseek-v4-pro").split() + ["--print"],
            input=smoke_prompt, capture_output=True, text=True, timeout=60,
            env={**os.environ, "DEEPSEEK_API_KEY": os.environ["DEEPSEEK_API_KEY"]}
        )
        if result.returncode != 0:
            issues.append(f"smoke: exit code {result.returncode}")
        if scan_secrets(result.stdout, "smoke:stdout"):
            pass
        if scan_secrets(result.stderr, "smoke:stderr"):
            pass
        if "model" not in result.stdout.lower() and "deepseek" not in result.stdout.lower():
            issues.append("smoke: response does not identify model")
    except subprocess.TimeoutExpired:
        issues.append("smoke: timeout (60s)")
    except Exception as e:
        issues.append(f"smoke: {e}")

# Report
if issues:
    print(f"\n❌ {len(issues)} issue(s) found:")
    for i in issues:
        print(f"  - {i}")
    sys.exit(1)
else:
    print("\n✓ All checks passed")
    sys.exit(0)
