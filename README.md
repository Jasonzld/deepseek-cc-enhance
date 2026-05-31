# DeepSeek CC Enhance

Two deployable skills that make DeepSeek models survive and thrive on Claude Code.

## deepseek-tool-repair

Tool-input repair layer implementing Ahmad Awais's harness methodology. Fixes 6 tool-calling failure patterns before Zod validation.

```bash
cd deepseek-tool-repair && node scripts/setup.mjs
```

## deepseek-claudecode-agent

Codex skill for bounded DeepSeek delegation with autoresearch, self-healing diagnostics, and safe cross-device packaging.

```bash
cd deepseek-claudecode-agent && bash scripts/install_deepseek_skill.sh
```

## Reference

Ahmad Awais (@MrAhmadAwais): "how did we make deepseek outperform opus 4.7?"
https://x.com/MrAhmadAwais/status/2050956678502420612
