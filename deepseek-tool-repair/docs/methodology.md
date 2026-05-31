# Awais Harness Methodology

## Source

Ahmad Awais (@MrAhmadAwais): "how did we make deepseek outperform opus 4.7?"
https://x.com/MrAhmadAwais/status/2050956678502420612

## Core Thesis

> "open model bad at tool calling" is almost always a harness problem, not a model problem.

The failure modes aren't random — they're a small finite compositional set. Four repairs, ~30-100 lines each. That is the whole catalogue.

## The Four Failure Patterns

1. **null-for-optional**: Sending `null` for an optional field instead of omitting it
2. **stringified JSON arrays**: Emitting `["a","b"]` as a JSON *string* instead of an actual array
3. **wrapped single arg**: Wrapping a single arg in `{}` where schema expected an array
4. **bare string for array**: Passing a bare string where an array was expected

## Additional Patterns Discovered

5. **markdown auto-link leak**: Model emits file paths as markdown auto-links `[path](url)` — the post-training chat distribution leaking through the tool boundary
6. **relational invariant violation**: Paired fields (offset/limit) where only one is provided

## Design Principle: Validate-Then-Repair

> "when you preprocess, you encode a prior about what's broken. when you let the validator complain first, the schema is the prior, and you only spend repair budget at the exact paths the schema actually disagreed at."

1. Parse as-is. If success, ship. Valid inputs never touched.
2. On failure, walk the validator's issue list.
3. Try each repair in order until one applies.
4. Parse again. Success → log + execute. Failure → return model-readable retry.

## Ordering Constraint

> "json-array-parse must run before bare-string-wrap or `'["a","b"]'` becomes `['["a","b"]']`"

The repair pipeline order:
1. null-for-optional
2. stringified-array (before bare-string-wrap)
3. markdown-autolink
4. wrapped-single-arg
5. bare-string-for-array (after stringified-array)

## Content Protection

> "my first attempt was a preprocessing pass... writeFile content that happened to be json-shaped got rewritten before it hit disk. silent corruption, easy to miss in a smoke test."

Fields excluded from repair: content, old_string, new_string, command, script, query, message, body, description, reason, prompt, question, answer, summary, text, html, markdown, additionalContext, systemMessage

## Transparency

> "no `Error:` prefix, so the TUI doesn't paint it red. the model sees what we picked and can self-correct on the next turn."

For relational defaults, feedback uses "Note:" not "Error:" — the model can self-correct if the default was wrong.

## Results

DeepSeek V4 Pro beats Opus 4.7 6/10 times on internal evals. The model didn't change. The contract got more forgiving in exactly the places it needed to be.
