# DeepSeek CC Enhance

Make DeepSeek models **reliable** on Claude Code. Two production-grade skills that fix tool-calling failures before they happen, and provide a self-healing research lane for bounded delegation.

> Built from Ahmad Awais's harness methodology: "The failure modes aren't random — they're a small finite compositional set. Four repairs, ~30-100 lines each. That is the whole catalogue."

[![Tests](https://img.shields.io/badge/tests-33%2F33%20passed-brightgreen)](deepseek-tool-repair/tests/tool-repair-test.mjs)
[![Node](https://img.shields.io/badge/node-18%2B-blue)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/claude--code-v2.0.10%2B-orange)](https://code.claude.com)

---

## Why

Open models (DeepSeek, Qwen, GLM) fail at tool calling not because they lack capability — but because the **harness contract is too strict**. The same 6 failure patterns repeat across all open models. Fix the harness, not the model.

> "DeepSeek V4 Pro now beats Opus 4.7 6/10 times on our internal evals. The model didn't change. The contract got more forgiving." — Ahmad Awais

## What's Here

| Skill | For | Does |
|-------|-----|------|
| `deepseek-tool-repair` | **Claude Code** | Transparent PreToolUse hook that repairs 6 tool-calling failure patterns before Zod validation |
| `deepseek-claudecode-agent` | **Codex** | Bounded DeepSeek delegation with autoresearch contract, self-healing, and safe packaging |

---

## Quick Start

### deepseek-tool-repair (Claude Code)

```bash
cd deepseek-tool-repair
node scripts/setup.mjs
```

This registers two hooks (`PreToolUse` + `PostToolUseFailure`) in `~/.claude/settings.local.json`, backs up your existing settings, and runs 33 adversarial tests.

**Verify:**
```bash
node tests/tool-repair-test.mjs
# Expected: 33 passed, 0 failed
```

**Monitor repair rates:**
```bash
node scripts/stats.mjs --live
```

**Uninstall:**
```bash
node scripts/setup.mjs --uninstall
```

### deepseek-claudecode-agent (Codex)

```bash
cd deepseek-claudecode-agent
bash scripts/install_deepseek_skill.sh   # Linux/macOS
# or
powershell -File scripts/install_deepseek_skill.ps1  # Windows
```

Requires `DEEPSEEK_API_KEY` and `CLAUDECODE_DEEPSEEK_CMD` env vars. Never put secrets in command templates.

---

## How It Works

```
DeepSeek generates JSON (possibly malformed)
              │
              ▼
┌──── PreToolUse Hook ────┐
│  6 ordered repairs       │
│  Silent fast-path        │  ← ~0ms overhead for valid inputs
└──────────────────────────┘
              │
              ▼
    Claude Code Zod validation
              │
       ┌──────┴──────┐
       ▼              ▼
    成功            失败
                        │
                        ▼
         ┌─ PostToolUseFailure Hook ──┐
         │  Error classification       │
         │  EN + CN + repair context   │
         └─────────────────────────────┘
```

### The 6 Repairs

| # | Repair | Detects | Before | After |
|---|--------|---------|--------|-------|
| 1 | null-for-optional | `null` for optional fields | `{limit: null}` | `{}` |
| 2 | stringified-array | JSON string instead of array | `{args: '["a"]'}` | `{args: ["a"]}` |
| 3 | markdown-autolink | Auto-link leak in file paths | `[file.md](http://file.md)` | `file.md` |
| 4 | wrapped-single-arg | Object where array expected | `{args: {cmd:"x"}}` | `{args: ["x"]}` |
| 5 | bare-string-for-array | String where array expected | `{args: "npm"}` | `{args: ["npm"]}` |
| 6 | relational-default | Missing paired field | `{offset: 100}` | `{offset: 100, limit: 2000}` |

**Critical ordering**: Repair 2 runs before Repair 5, or `'["a","b"]'` would become `['["a","b"]']`.

### Content Protection

To prevent silent corruption (Awais's key warning), these fields are **never** modified: `content`, `old_string`, `new_string`, `command`, `script`, `query`, `message`, `body`, `description`, `reason`, `prompt`, `question`, `answer`, `summary`, `text`, `html`, `markdown`, `additionalContext`, `systemMessage`.

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Schema-agnostic** | Hook layer cannot access Zod schemas. Uses field-name heuristics + content blocklists instead. |
| **Preprocess, don't validate** | Cannot run Zod from hooks. Applies narrow, atomic repairs — each targets a specific known failure pattern. |
| **Recursion depth limit (50)** | Prevents stack overflow on pathological inputs. |
| **Tool allowlist/denylist** | `TOOL_ALLOWLIST` / `TOOL_DENYLIST` in `tool-repair-prehook.mjs` to scope repairs. Empty = repair all tools. |
| **Transparent defaults** | Relational notes use `Note:` (not `Error:`) — TUI won't paint red. Model can self-correct. |
| **5s → 15s state TTL** | Covers longer tool executions; `tool_use_id` matching prevents cross-call interference. |

---

## Testing

```bash
node deepseek-tool-repair/tests/tool-repair-test.mjs
```

33 adversarial cases covering:
- All 6 repair types
- Content field protection
- Nested/composite repairs
- Array recursion edge cases
- Empty/null/primitive inputs
- Ordering constraints
- Relational invariant defaults

---

## Security

- No API keys in source, prompts, or command templates
- `package_deepseek_skill.py` scans for secrets before packaging
- `doctor_deepseek_claudecode.py` validates env vars without printing values
- Settings backup before registration; rollback via `.bak` restore
- `TOOL_DENYLIST` to exclude dangerous tools from repair

---

## Self-Healing

Run the doctor after deployment or when something fails:

```bash
python deepseek-claudecode-agent/scripts/doctor_deepseek_claudecode.py
```

Checks: Python version, env vars (existence only), command template sanity, ClaudeCode binary, skill file integrity, metadata redaction, optional smoke prompt.

---

## Contributing

Issues and PRs welcome. Key constraints:

1. **Never add secrets**. The secret scanner runs on every package. If you add a key, it will be caught.
2. **Add tests** for new repair patterns. Hook behavior must be deterministic.
3. **Run doctor** after changes that touch env/command/packaging paths.
4. **Failure classification**: record repeated failures as improvement candidates in `runs/<id>/improvement_candidates.md`. Do not auto-modify SKILL.md or core scripts.

### Development

```bash
git clone https://github.com/Jasonzld/deepseek-cc-enhance.git
cd deepseek-cc-enhance/deepseek-tool-repair
node scripts/setup.mjs --dry-run    # preview changes
node tests/tool-repair-test.mjs      # run tests
```

---

## Reference

- **Ahmad Awais** (@MrAhmadAwais): ["how did we make deepseek outperform opus 4.7?"](https://x.com/MrAhmadAwais/status/2050956678502420612)
- [Methodology docs](deepseek-tool-repair/docs/methodology.md)
- [Autoresearch repair contract](deepseek-claudecode-agent/references/autoresearch-repair-contract.md)

## License

MIT
