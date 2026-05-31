#!/usr/bin/env node
/**
 * PostToolUseFailure Hook: Repair-Aware Error Guidance
 * =====================================================
 * Reads last-repair.json state written by the PreToolUse repair hook.
 * If a repair was applied but the tool still failed, gives the model
 * targeted guidance instead of generic "try a different approach."
 *
 * Key insight from Awais: "the model knows how to format a path. it just
 * hasn't been told clearly enough that this path is going to fopen."
 *
 * This hook tells the model exactly what went wrong in model-readable form.
 * No "Error:" prefix on relational notes — the TUI won't paint them red.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const STATE_DIR = join(homedir(), '.omc', 'state', 'tool-repair');

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    import('fs').then(fs => {
      const chunks = [];
      const buf = Buffer.alloc(65536);
      const timer = setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8')), timeoutMs);
      function tryRead() {
        try {
          const bytes = fs.readSync(0, buf, 0, buf.length, null);
          if (bytes === 0) { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8')); return; }
          chunks.push(Buffer.from(buf.subarray(0, bytes)));
          setImmediate(tryRead);
        } catch { clearTimeout(timer); resolve(chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : ''); }
      }
      tryRead();
    }).catch(() => resolve(''));
  });
}

// ---------------------------------------------------------------------------
// Read repair state from PreToolUse hook
// ---------------------------------------------------------------------------

function readRepairState() {
  const path = join(STATE_DIR, 'last-repair.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const state = JSON.parse(raw);
    // Only consider state from the last 15 seconds (covers longer tool executions)
    const stateTime = new Date(state.ts).getTime();
    if (isNaN(stateTime)) return null;
    const age = Date.now() - stateTime;
    if (age > 15000) return null;
    return state;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Classify errors into model-readable guidance
// ---------------------------------------------------------------------------

function classifyError(errorText) {
  if (!errorText) return null;

  // Normalize encoding (DeepSeek often returns garbled Chinese in Windows codepage)
  const text = String(errorText);

  // ---- Zod validation errors (English + Chinese) ----

  // English patterns
  const isZod = text.includes('ZodError') || text.includes('validation_error') ||
      text.includes('invalid_type') || text.includes('invalid_union') ||
      text.includes('Required') || text.includes('Expected');

  // Chinese patterns (DeepSeek/GLM/Qwen — garbled on Windows, but some patterns survive)
  const isCnZod = text.includes('无效') || text.includes('验证') || text.includes('类型') ||
      text.includes('必须') || text.includes('需要') || text.includes('缺少') ||
      text.includes('不应') || text.includes('无法识别') || text.includes('格式错误');

  if (isZod || isCnZod) {

    // English patterns
    if (text.includes('Expected array, received string')) {
      return 'Hint: bare string where array expected. Wrap in brackets: "value" → ["value"]. The harness auto-fixes this next time.';
    }
    if (text.includes('Expected array, received object')) {
      return 'Hint: object {} where array [] expected. The harness auto-fixes this next time.';
    }
    if (text.includes('Expected string, received null')) {
      return 'Hint: null sent for required field. Omit optional fields instead of null. The harness auto-fixes this next time.';
    }
    if (text.includes('Unrecognized key') || text.includes('invalid key')) {
      return 'Hint: check field names for typos. The schema rejected an unexpected key.';
    }
    if (text.includes('invalid_literal') || text.includes('invalid_enum_value')) {
      return 'Hint: check allowed values for this field — value not in enum.';
    }

    // Chinese patterns
    if (text.includes('数组') && text.includes('字符串')) {
      return 'Hint: 需要数组但传入字符串。用括号包裹: "val" → ["val"]。修复层下次自动修正。';
    }
    if (text.includes('数组') && text.includes('对象')) {
      return 'Hint: 需要数组但传入对象。修复层下次自动修正。';
    }
    if (text.includes('null') && (text.includes('必须') || text.includes('缺少'))) {
      return 'Hint: 可选字段传了 null。省略而非传 null。修复层下次自动修正。';
    }

    return 'Hint: Zod/validation error. Check field types and required keys. The harness auto-fixes: null-for-optional, stringified arrays, bare strings, wrapped args, markdown auto-links.';
  }

  // Shell command errors — often encoding/escaping issues
  if (text.includes('CommandNotFound') || text.includes('is not recognized')) {
    return 'Hint: the shell command syntax may have encoding issues. Try using simple command names without special characters, or use a script file instead.';
  }

  // File not found
  if (text.includes('ENOENT') || text.includes('no such file')) {
    return 'Hint: file not found. Verify the path is absolute and the file exists. The harness auto-unwraps markdown auto-links in paths like [file.md](url).';
  }

  // General guidance
  if (text.includes('permission denied') || text.includes('EACCES')) {
    return 'Hint: permission denied. Try a different path or check file permissions.';
  }

  return null; // No specific guidance
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let data;
  try {
    const input = await readStdin(2000);
    if (!input) { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', permissionDecision: 'allow' } })); return; }
    data = JSON.parse(input);
  } catch { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', permissionDecision: 'allow' } })); return; }

  const toolName = data.tool_name || data.toolName || '';
  const toolUseId = data.tool_use_id || data.toolUseId || '';
  const rawError = data.error || '';
  const isInterrupt = data.is_interrupt || false;

  // Unwrap error object (protocol may send {message, code, stack} instead of string)
  const errorText = typeof rawError === 'object' && rawError !== null
    ? (rawError.message || rawError.text || rawError.code || String(rawError))
    : String(rawError || '');

  if (isInterrupt) { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', permissionDecision: 'allow' } })); return; }

  // Check if a repair was applied by the PreToolUse hook for THIS tool invocation
  const repairState = readRepairState();
  const wasRepaired = repairState && repairState.repairs && repairState.repairs.length > 0
    && repairState.tool === toolName
    && toolUseId && repairState.tool_use_id === toolUseId;

  // If no error text and no repair, silent exit
  if (!errorText && !wasRepaired) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', permissionDecision: 'allow' } }));
    return;
  }

  // Classify the error for model guidance
  const guidance = errorText ? classifyError(errorText) : null;

  // Build output
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      permissionDecision: 'allow',
    }
  };

  const messages = [];

  if (wasRepaired) {
    messages.push(
      'Tool "' + toolName + '" failed despite input repair (' +
      repairState.repairs.join(', ') + '). The error is NOT a shape issue — ' +
      'the input format was corrected. Check the actual tool logic, file existence, ' +
      'or permissions instead of retrying the same input format.'
    );
    if (repairState.notes && repairState.notes.length > 0) {
      messages.push(...repairState.notes);
    }
  }

  if (guidance) {
    messages.push(guidance);
  }

  if (messages.length > 0) {
    out.hookSpecificOutput.additionalContext = messages.join('\n');
  }

  console.log(JSON.stringify(out));
}

main().catch(() => { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', permissionDecision: 'allow' } })); });
