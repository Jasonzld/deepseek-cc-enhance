---
name: deepseek-tool-repair
description: Deployable Awais-methodology tool-input repair layer for DeepSeek/GLM/Qwen models on Claude Code. Fixes 6 tool-calling failure patterns before Zod validation — making open models survive JSON contract mismatches. One-command deploy. Portable across Windows/Linux/Mac.
version: 1.0.0
author: Built from Ahmad Awais (@MrAhmadAwais) harness methodology
---

# DeepSeek Tool-Repair Harness

A deployable skill that implements Ahmad Awais's tool-input repair methodology for Claude Code. Fixes DeepSeek/GLM/Qwen tool-calling failures by intercepting and repairing model-generated JSON BEFORE Zod validation.

## Why

Open models (DeepSeek, Qwen, GLM) fail at tool calling not because they lack capability, but because the harness contract is too strict. The same 6 failure patterns repeat across all open models. Fix the harness, not the model.

## What It Does

| Repair | Failure Pattern | Example |
|--------|---------------|---------|
| null-for-optional | `limit: null` instead of omitting | `{limit: null}` → `{}` |
| stringified-array | `'["a","b"]'` as JSON string | `{args: '["a"]'}` → `{args: ["a"]}` |
| markdown-autolink | `[file.md](http://file.md)` in paths | unwraps degenerate auto-links |
| wrapped-single-arg | `{args: {cmd: "x"}}` for array field | `{args: {cmd: "x"}}` → `{args: ["x"]}` |
| bare-string-for-array | `"foo"` where `["foo"]` expected | `{args: "npm"}` → `{args: ["npm"]}` |
| relational-default | `offset` without `limit` | auto-fills paired defaults |

## Quick Deploy

```bash
node ~/.claude/skills/deepseek-tool-repair/scripts/setup.mjs
```

This registers PreToolUse and PostToolUseFailure hooks in `settings.local.json`, copies hook scripts, and runs the test suite.

## Requirements

- Claude Code v2.0.10+
- Node.js v18+
- DeepSeek API configured as Claude Code model backend

## Architecture

```
Model generates JSON (possibly malformed)
        │
        ▼
┌── PreToolUse: tool-repair-prehook.mjs ──┐
│  6 ordered repairs → updatedInput         │
│  Silent pass-through for valid inputs     │
└──────────────────────────────────────────┘
        │
        ▼
  Claude Code Zod validation
        │
   ┌────┴────┐
   ▼         ▼
 成功       失败
              │
              ▼
  ┌─ PostToolUseFailure: tool-repair-postfailure.mjs ──┐
  │  Error classification (EN + CN) + repair context     │
  └────────────────────────────────────────────────────┘
```

## Files

```
deepseek-tool-repair/
  SKILL.md                          # this file
  hooks/
    tool-repair-prehook.mjs         # PreToolUse repair layer
    tool-repair-postfailure.mjs     # PostToolUseFailure enhancement
    tool-repair.mjs                 # standalone importable module
  scripts/
    setup.mjs                       # one-command deploy
    stats.mjs                       # repair telemetry viewer
  tests/
    tool-repair-test.mjs            # 33 adversarial test cases
  docs/
    methodology.md                  # Awais methodology reference
```

## Verification

```bash
node ~/.claude/skills/deepseek-tool-repair/tests/tool-repair-test.mjs
# Expected: 33 passed, 0 failed

node ~/.claude/skills/deepseek-tool-repair/scripts/stats.mjs
# Shows per-tool, per-repair-type telemetry
```

## Uninstall

```bash
# Remove hook registrations from settings.local.json
# Delete ~/.claude/skills/deepseek-tool-repair/
# Session restart or /reload-plugins
```

## Reference

Ahmad Awais (@MrAhmadAwais): "how did we make deepseek outperform opus 4.7?"
https://x.com/MrAhmadAwais/status/2050956678502420612

Key insight: "The failure modes aren't random — they're a small finite compositional set.
Four repairs, ~30-100 lines each. That is the whole catalogue."
