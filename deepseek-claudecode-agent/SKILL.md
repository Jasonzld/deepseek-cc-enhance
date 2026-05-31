---
name: deepseek-claudecode-agent
description: Run DeepSeek V4 Pro through a ClaudeCode-compatible CLI as a bounded autoresearch, repair, review, packaging, sharing, and cross-device deployment lane with self-healing diagnostics. Use for DeepSeek delegation, reverse-analysis verification, tool/config repair, smoke testing, and safe skill distribution without exposing API keys.
---

# DeepSeek ClaudeCode Agent

Use this skill to run DeepSeek as an external research and repair lane. Codex keeps final responsibility for verification, edits, tests, and deployment.

## Hard Rules

- Keep API keys only in environment variables or OS secret stores.
- Never place secrets in prompts, command templates, files, transcripts, or chat.
- Treat any key seen in history, logs, prompts, or copied config as compromised; rotate it.
- Treat DeepSeek output as advisory evidence. Verify every actionable claim locally.
- Keep each run bounded: one task, explicit cwd, explicit output dir, explicit timeout.

## Workflow

1. Inventory local evidence first: files, configs, logs, tests, docs, prior runs.
2. Write a falsifiable task prompt with evidence excerpts and open questions.
3. Run `scripts/run_deepseek_claudecode.py`.
4. Review `stdout.txt`, `stderr.txt`, `metadata.json`, `summary.md`, and `manifest.json`.
5. Verify DeepSeek claims against local evidence before editing.
6. Apply the smallest verified fix.
7. Run tests, smoke checks, or operational probes.
8. Run `scripts/doctor_deepseek_claudecode.py` after repair or deployment.
9. Package with `scripts/package_deepseek_skill.py` before sharing.
10. Record repeated failure classes as improvement candidates, not silent behavior changes.

## Required Environment

- `DEEPSEEK_API_KEY`: required; never printed.
- `CLAUDECODE_DEEPSEEK_CMD`: command template, may contain `{model}`, must not contain secrets.

## Autoresearch Prompt Contract

```text
Task:
Evidence reviewed:
Findings:
Root cause:
Proposed fix:
Verification plan:
Claims requiring local verification:
Confidence:
Known gaps:
```

## Self-Healing

Run doctor when setup, command invocation, output parsing, timeout, packaging, or deployment fails. Doctor checks: Python version, env vars (existence only), command template sanity, ClaudeCode command resolves, skill file integrity, metadata redaction, optional smoke prompt.

## Sharing

Package only durable files. Exclude: runs/, *.env, *.key, stdout.txt, stderr.txt, prompt.txt, metadata.json, local configs with tokens.
