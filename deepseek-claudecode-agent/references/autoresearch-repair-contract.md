# Autoresearch Repair Contract

## Prompt Contract

Every DeepSeek prompt must request this structured response:

```text
Task: <one-line summary>
Evidence reviewed: <file paths, line numbers, log excerpts>
Findings: <numbered claims>
Root cause: <specific mechanism>
Proposed fix: <concrete change with scope>
Verification plan: <commands, tests, expected outputs>
Claims requiring local verification: <what Codex must check>
Confidence: high/medium/low with reasoning
Known gaps: <what was not investigated>
```

## Evidence Rules

- Claims must cite specific file paths, line numbers, addresses, or log entries.
- Reject responses that say "probably" or "likely" without evidence.
- Reject responses that reference code not found in the provided evidence.

## Failure Classification

When a DeepSeek run fails, classify the failure:

| Class | Pattern | Action |
|-------|--------|--------|
| TIMEOUT | >timeout seconds, no output | Reduce scope, retry with smaller input |
| PARSE | JSON/markdown output unparseable | Check prompt contract, retry with stricter format |
| HALLUCINATION | Claims reference non-existent files | Discard, provide evidence inventory, retry |
| SECRET_LEAK | Output contains key-like text | ABORT. Rotate keys. Do NOT retry. |
| EMPTY | Zero output, no error | Check command template, env vars |
| CRASH | Non-zero exit, stderr present | Log to improvement_candidates.md |

## Self-Improvement

Record repeated failures of the same class to `runs/<run_id>/improvement_candidates.md`. When the same PARSE or HALLUCINATION class repeats 3+ times across runs, flag the skill prompt for human review. Do NOT auto-modify SKILL.md or scripts.
