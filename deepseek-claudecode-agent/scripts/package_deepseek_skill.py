#!/usr/bin/env python3
"""Package deepseek-claudecode-agent for safe cross-device sharing.
Scans for secrets, builds manifest, produces deployable archive.
"""

import os, sys, hashlib, json, shutil, re
from pathlib import Path
from datetime import datetime, timezone

SKILL_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_PATTERNS = ["runs/", "*.env", "*.key", "stdout.txt", "stderr.txt",
                    "prompt.txt", "metadata.json", "__pycache__", "*.pyc", ".DS_Store"]
SECRET_PAT = re.compile(r'sk-[a-zA-Z0-9]{32,}|apiKey["\s:=]+[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9_-]{20,}')

def should_exclude(path):
    rel = str(path.relative_to(SKILL_ROOT))
    for pat in EXCLUDE_PATTERNS:
        if pat.startswith("*"):
            if rel.endswith(pat[1:]) or (pat == "*.pyc" and rel.endswith(".pyc")):
                return True
        elif pat.endswith("/"):
            if rel.startswith(pat) or rel == pat[:-1]:
                return True
        elif rel == pat:
            return True
    return False

def scan_file(path):
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
        matches = SECRET_PAT.findall(text)
        if matches:
            print(f"  ⚠ SECRET FOUND in {path.relative_to(SKILL_ROOT)}: {matches[0][:30]}...")
            return True
    except:
        pass
    return False

# Scan
print("Scanning for secrets...")
found = False
for f in sorted(SKILL_ROOT.rglob("*")):
    if f.is_dir() or should_exclude(f):
        continue
    if scan_file(f):
        found = True

if found:
    print("\n✗ Package aborted: secrets detected. Rotate keys and remove from files before packaging.")
    sys.exit(1)

# Build manifest
manifest = {
    "skill": "deepseek-claudecode-agent",
    "packaged_at": datetime.now(timezone.utc).isoformat(),
    "files": {}
}
for f in sorted(SKILL_ROOT.rglob("*")):
    if f.is_dir() or should_exclude(f):
        continue
    rel = str(f.relative_to(SKILL_ROOT)).replace("\\", "/")
    sha = hashlib.sha256(f.read_bytes()).hexdigest()
    manifest["files"][rel] = sha

# Write manifest
manifest_path = SKILL_ROOT / "manifest.json"
manifest_path.write_text(json.dumps(manifest, indent=2))
print(f"✓ Manifest: {manifest_path} ({len(manifest['files'])} files)")

# Package
import zipfile
pkg_name = f"deepseek-claudecode-agent-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
pkg_path = SKILL_ROOT.parent / pkg_name
with zipfile.ZipFile(pkg_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for rel, sha in manifest["files"].items():
        zf.write(SKILL_ROOT / rel, f"deepseek-claudecode-agent/{rel}")

print(f"✓ Package: {pkg_path} ({pkg_path.stat().st_size} bytes)")
print(f"\nDeploy: unzip {pkg_name} into ~/.codex/skills/ or $CODEX_HOME/skills/")
