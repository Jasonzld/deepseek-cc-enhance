#!/usr/bin/env python3
"""Run a bounded prompt through a ClaudeCode-compatible DeepSeek command."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import platform
import shlex
import subprocess
import sys
from typing import Optional


DEFAULT_MODEL = "deepseek-v4-pro"
DEFAULT_COMMAND = "claude --model {model} --print"


def read_windows_env(name: str) -> Optional[str]:
    if platform.system() != "Windows":
        return None
    try:
        import winreg
    except ImportError:
        return None
    locations = (
        (winreg.HKEY_CURRENT_USER, "Environment"),
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    )
    for hive, subkey in locations:
        try:
            with winreg.OpenKey(hive, subkey) as key:
                value, _ = winreg.QueryValueEx(key, name)
                if value:
                    return str(value)
        except OSError:
            continue
    return None


def env_value(name: str) -> Optional[str]:
    return os.environ.get(name) or read_windows_env(name)


def redact_env(env: dict[str, str]) -> dict[str, str]:
    redacted = {}
    for key in ("DEEPSEEK_API_KEY", "CLAUDECODE_DEEPSEEK_CMD"):
        value = env.get(key)
        if not value:
            continue
        redacted[key] = "<set>" if "KEY" in key or "TOKEN" in key else value
    return redacted


def build_command(template: str, model: str) -> list[str]:
    command = shlex.split(template.format(model=model), posix=(platform.system() != "Windows"))
    if platform.system() == "Windows" and command and command[0].lower() == "claude":
        resolved = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-Command claude -ErrorAction SilentlyContinue).Source",
            ],
            text=True,
            capture_output=True,
        )
        source = resolved.stdout.strip()
        if source.lower().endswith(".ps1"):
            command = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", source] + command[1:]
    return command


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt-file", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    parser.add_argument("--model", default=os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL))
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()

    prompt_file = args.prompt_file.resolve()
    out_dir = args.out_dir.resolve()
    cwd = args.cwd.resolve()

    api_key = env_value("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is not set; refusing to run without env-based secret handling")
    os.environ["DEEPSEEK_API_KEY"] = api_key
    if not prompt_file.is_file():
        raise SystemExit(f"prompt file not found: {prompt_file}")

    out_dir.mkdir(parents=True, exist_ok=True)
    prompt = prompt_file.read_text(encoding="utf-8")
    template = env_value("CLAUDECODE_DEEPSEEK_CMD") or DEFAULT_COMMAND
    os.environ["CLAUDECODE_DEEPSEEK_CMD"] = template
    command = build_command(template, args.model)

    started = dt.datetime.now(dt.timezone.utc).isoformat()
    metadata = {
        "started_utc": started,
        "prompt_file": str(prompt_file),
        "out_dir": str(out_dir),
        "cwd": str(cwd),
        "model": args.model,
        "command": command,
        "environment": redact_env(os.environ),
    }

    (out_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    try:
        proc = subprocess.run(
            command,
            input=prompt,
            text=True,
            cwd=str(cwd),
            capture_output=True,
            timeout=args.timeout,
            env=os.environ.copy(),
        )
    except FileNotFoundError as exc:
        raise SystemExit(f"command not found: {command[0]}; set CLAUDECODE_DEEPSEEK_CMD") from exc
    except subprocess.TimeoutExpired as exc:
        (out_dir / "stdout.txt").write_text(exc.stdout or "", encoding="utf-8")
        (out_dir / "stderr.txt").write_text(exc.stderr or "", encoding="utf-8")
        raise SystemExit(f"timed out after {args.timeout}s")

    (out_dir / "stdout.txt").write_text(proc.stdout, encoding="utf-8")
    (out_dir / "stderr.txt").write_text(proc.stderr, encoding="utf-8")

    finished = dt.datetime.now(dt.timezone.utc).isoformat()
    metadata["finished_utc"] = finished
    metadata["returncode"] = proc.returncode
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = [
        "# DeepSeek ClaudeCode Run",
        "",
        f"- Model: `{args.model}`",
        f"- Return code: `{proc.returncode}`",
        f"- Prompt: `{prompt_file}`",
        f"- Stdout: `{out_dir / 'stdout.txt'}`",
        f"- Stderr: `{out_dir / 'stderr.txt'}`",
        "",
    ]
    (out_dir / "summary.md").write_text("\n".join(summary), encoding="utf-8")
    print(f"wrote {out_dir}")
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
