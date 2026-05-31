#!/usr/bin/env node
/**
 * PreToolUse Hook: Tool-Input Repair Layer — FULLY AUTOMATIC
 * ===========================================================
 * Zero user prompts. Zero user intervention. Silent on fast path.
 *
 * Repairs applied before Zod validation:
 *   1. null-for-optional      — transparent (model unaware)
 *   2. stringified-array      — transparent
 *   3. markdown-autolink      — transparent
 *   4. wrapped-single-arg     — transparent
 *   5. bare-string-for-array  — transparent
 *   6. relational-default     — model gets transparent feedback via additionalContext
 *
 * Hook protocol (Claude Code v2.0.10+):
 *   stdin:  JSON { tool_name, tool_input, cwd, ... }
 *   stdout: JSON { hookSpecificOutput: { permissionDecision, updatedInput?, additionalContext? } }
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync, appendFileSync, statSync, readSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Safety limits — prevent stack overflow on pathological inputs
// ---------------------------------------------------------------------------

const MAX_RECURSION_DEPTH = 50;

// ---------------------------------------------------------------------------
// Tool allowlist/denylist — control which tools get repaired
// ---------------------------------------------------------------------------

// Only repair these tools (empty = repair all)
const TOOL_ALLOWLIST = new Set([]);

// Never repair these tools — same field names, different semantics across tools
const TOOL_DENYLIST = new Set([
  'Skill', 'skill',           // args is string (not array like Bash)
  'AskUserQuestion',          // questions/options are objects (not strings)
  'Task', 'task',             // subagent_type, prompt are strings
  'Agent', 'agent',           // same reason
]);

function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const chunks = [];
    const buf = Buffer.alloc(65536);
    const timer = setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8')), timeoutMs);

    function tryRead() {
      try {
        const bytes = readSync(0, buf, 0, buf.length, null);
        if (bytes === 0) { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8')); return; }
        chunks.push(Buffer.from(buf.subarray(0, bytes)));
        setImmediate(tryRead);
      } catch (err) {
        clearTimeout(timer);
        resolve(chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : '');
      }
    }
    tryRead();
  });
}

// ---------------------------------------------------------------------------
// Field blocklists — prevent content corruption (Awais: "silent corruption, easy to miss")
// ---------------------------------------------------------------------------

// Fields that contain arbitrary user content — NEVER parse as JSON or repair
const NO_PARSE_FIELDS = new Set([
  'content', 'old_string', 'new_string', 'oldString', 'newString',
  'text', 'message', 'body', 'description', 'reason', 'prompt',
  'question', 'answer', 'summary', 'additionalContext', 'systemMessage',
  'command', 'script', 'query', 'regex', 'html', 'markdown',
]);

// Fields known to expect string values — skip auto-link repair
const NO_AUTOLINK_FIELDS = new Set([
  'content', 'old_string', 'new_string', 'oldString', 'newString',
  'message', 'reason', 'prompt', 'description', 'text', 'body',
  'question', 'answer', 'summary', 'additionalContext', 'systemMessage',
  'command', 'script', 'query',
]);

// Fields known to expect array values
const ARRAY_FIELDS = new Set([
  'args', 'file_paths', 'patterns',
  'files', 'paths', 'commands', 'globs',
  'serverAddresses', 'aggregatedPackageFullNames', 'tags',
  'ignore', 'include', 'exclude',
]);

// ---------------------------------------------------------------------------
// 6 Repair functions (inline for zero-dependency hook execution)
// ---------------------------------------------------------------------------

function r_nullOptional(obj) {
  if (!obj || typeof obj !== 'object') return { r: obj, ok: false };
  if (Array.isArray(obj)) {
    let ok = false;
    const f = obj.map(x => {
      if (x === null) { ok = true; return undefined; }
      if (typeof x === 'object') { const s = r_nullOptional(x); if (s.ok) ok = true; return s.r; }
      return x;
    }).filter(x => x !== undefined);
    return { r: f, ok };
  }
  let ok = false; const c = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) { ok = true; continue; }
    if (Array.isArray(v)) {
      const s = r_nullOptional(v); if (s.ok) ok = true; c[k] = s.r;
    } else if (typeof v === 'object' && v !== null) {
      const s = r_nullOptional(v); if (s.ok) ok = true; c[k] = s.r;
    } else c[k] = v;
  }
  return { r: c, ok };
}

function r_stringifiedArrays(obj) {
  if (!obj || typeof obj !== 'object') return { r: obj, ok: false };
  if (Array.isArray(obj)) {
    let ok = false;
    const f = obj.map(x => { const s = r_stringifiedArrays(x); if (s.ok) ok = true; return s.r; });
    return { r: f, ok };
  }
  let ok = false; const f = {};
  for (const [k, v] of Object.entries(obj)) {
    // CRITICAL: never parse content fields as JSON (Awais: "silent corruption, easy to miss")
    if (typeof v === 'string' && !NO_PARSE_FIELDS.has(k)) {
      const t = v.trim();
      if (t.startsWith('[') && t.endsWith(']')) {
        try { const p = JSON.parse(t); if (Array.isArray(p)) { f[k] = p; ok = true; continue; } } catch {}
      }
      if (t.startsWith('"[') && t.endsWith(']"')) {
        try { const p = JSON.parse(t.slice(1, -1)); if (Array.isArray(p)) { f[k] = p; ok = true; continue; } } catch {}
      }
    }
    if (typeof v === 'object' && v !== null) { const s = r_stringifiedArrays(v); if (s.ok) ok = true; f[k] = s.r; }
    else f[k] = v;
  }
  return { r: f, ok };
}

// Global regex — replaces ALL auto-links in a string, not just the first
const AL_RE_G = /\[([^\]]+)\]\(([^)]+)\)/g;
function r_autoLink(str) {
  if (typeof str !== 'string') return { r: str, ok: false };

  let ok = false;
  let result = str;

  // Collect all matches first, then replace only degenerate ones
  const matches = [...str.matchAll(AL_RE_G)];
  if (matches.length === 0) return { r: str, ok: false };

  for (const m of matches.reverse()) {
    const [full, text, url] = m;
    const noProto = url.replace(/^https?:\/\//, '');
    // Only unwrap when link text IS the URL path (degenerate auto-link)
    // text === noProto: [notes.md](http://notes.md) → notes.md
    // text === url:     [http://notes.md](http://notes.md) → http://notes.md
    // NOT: [bar](https://foo/bar) — text "bar" != urlNoProto "foo/bar", so preserved
    if (text === noProto || text === url) {
      // Replace only this occurrence (use index to avoid replacing wrong substring)
      result = result.substring(0, m.index) + text + result.substring(m.index + full.length);
      ok = true;
    }
  }

  return { r: result, ok };
}

function r_markdownAutoLinks(obj) {
  if (!obj || typeof obj !== 'object') return { r: obj, ok: false };
  if (Array.isArray(obj)) {
    let ok = false;
    const f = obj.map(x => {
      if (typeof x === 'string') { const s = r_autoLink(x); if (s.ok) ok = true; return s.r; }
      if (typeof x === 'object' && x !== null) { const s = r_markdownAutoLinks(x); if (s.ok) ok = true; return s.r; }
      return x;
    });
    return { r: f, ok };
  }
  let ok = false; const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && !NO_AUTOLINK_FIELDS.has(k)) { const s = r_autoLink(v); if (s.ok) { f[k] = s.r; ok = true; continue; } }
    if (typeof v === 'object' && v !== null) { const s = r_markdownAutoLinks(v); if (s.ok) ok = true; f[k] = s.r; }
    else f[k] = v;
  }
  return { r: f, ok };
}

// ARRAY_FIELDS defined above (line ~66)
function r_wrappedSingleArg(obj) {
  if (!obj || typeof obj !== 'object') return { r: obj, ok: false };
  if (Array.isArray(obj)) return { r: obj, ok: false };
  let ok = false; const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ARRAY_FIELDS.has(k) && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const ks = Object.keys(v);
      if (ks.length === 1) { f[k] = [v[ks[0]]]; ok = true; continue; }
      if (ks.length === 0) { f[k] = []; ok = true; continue; }
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) { const s = r_wrappedSingleArg(v); if (s.ok) ok = true; f[k] = s.r; }
    else f[k] = v;
  }
  return { r: f, ok };
}

function r_bareStringForArray(obj) {
  if (!obj || typeof obj !== 'object') return { r: obj, ok: false };
  if (Array.isArray(obj)) return { r: obj, ok: false };
  let ok = false; const f = {};
  for (const [k, v] of Object.entries(obj)) {
    // Don't wrap empty strings — model likely meant something else
    if (ARRAY_FIELDS.has(k) && typeof v === 'string' && v.length > 0) { f[k] = [v]; ok = true; continue; }
    if (typeof v === 'object' && v !== null) { const s = r_bareStringForArray(v); if (s.ok) ok = true; f[k] = s.r; }
    else f[k] = v;
  }
  return { r: f, ok };
}

const RT = new Set(['Read','read','read_file','readFile']);
function r_readRelational(obj, toolName) {
  if (!RT.has(toolName)) return { r: obj, ok: false, notes: [] };
  if (!obj || typeof obj !== 'object') return { r: obj, ok: false, notes: [] };
  let ok = false; const f = { ...obj }; const ns = [];
  // Normalize aliases to canonical field names
  const off = f.offset ?? f.offset_value;
  const lim = f.limit ?? f.limit_value;
  if (off !== undefined && lim === undefined) {
    f.limit = 2000; ok = true;
    ns.push('Note: limit not provided; defaulted to 2000 lines. To read more/fewer lines, retry with both offset and limit.');
  }
  if (lim !== undefined && off === undefined) {
    f.offset = 0; ok = true;
    ns.push('Note: offset not provided; defaulted to 0. To read from a specific line, retry with both offset and limit.');
  }
  // Normalize aliases: if we used offset_value/limit_value, ensure canonical field exists
  if (f.offset_value !== undefined && f.offset === undefined) { f.offset = f.offset_value; delete f.offset_value; ok = true; }
  if (f.limit_value !== undefined && f.limit === undefined) { f.limit = f.limit_value; delete f.limit_value; ok = true; }
  return { r: f, ok, notes: ns };
}

// Master pipeline — ORDER MATTERS
function repair(toolInput, toolName, depth = 0) {
  if (!toolInput || typeof toolInput !== 'object') return { result: toolInput, repairs: [], notes: [] };
  // Safety: refuse to repair beyond max depth
  if (depth > MAX_RECURSION_DEPTH) return { result: toolInput, repairs: [], notes: [] };
  const repairs = []; const notes = []; let c = toolInput;
  const steps = [r_nullOptional, r_stringifiedArrays, r_markdownAutoLinks, r_wrappedSingleArg, r_bareStringForArray];
  const names = ['null-for-optional','stringified-array','markdown-autolink','wrapped-single-arg','bare-string-for-array'];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i](c);
    if (s.ok) { repairs.push(names[i]); c = s.r; }
  }
  const s6 = r_readRelational(c, toolName);
  if (s6.ok) { repairs.push('relational-default'); c = s6.r; }
  if (s6.notes) notes.push(...s6.notes);
  return { result: c, repairs, notes };
}

// ---------------------------------------------------------------------------
// State file for PostToolUse hook consumption
// ---------------------------------------------------------------------------

const STATE_DIR = join(homedir(), '.omc', 'state', 'tool-repair');
const TELEMETRY_PATH = join(STATE_DIR, 'repairs.jsonl');
const MAX_TELEMETRY_MB = 10;

function logTelemetry(repairs, toolName) {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    // Rotate if > 10MB
    if (existsSync(TELEMETRY_PATH)) {
      const sz = statSync(TELEMETRY_PATH).size;
      if (sz > MAX_TELEMETRY_MB * 1024 * 1024) {
        try { renameSync(TELEMETRY_PATH, TELEMETRY_PATH + '.' + Date.now()); } catch {}
      }
    }
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      tool: toolName,
      repair: repairs.join('+'),
    });
    appendFileSync(TELEMETRY_PATH, entry + '\n');
  } catch {}
}

function writeState(repairs, notes, tool, toolUseId) {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const state = JSON.stringify({ repairs, notes, tool, tool_use_id: toolUseId || '', ts: new Date().toISOString() });
    const tmp = join(STATE_DIR, 'last-repair.json.tmp');
    const dst = join(STATE_DIR, 'last-repair.json');
    writeFileSync(tmp, state);
    try { renameSync(tmp, dst); } catch {
      // On Windows, rename can fail if dst is locked. Fall back to direct write.
      try { writeFileSync(dst, state); unlinkSync(tmp); } catch {}
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Main — hook entry point
// ---------------------------------------------------------------------------

const ALLOW_OUTPUT = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } });

async function main() {
  let data;
  try {
    const input = await readStdin(2000);
    if (!input) { console.log(ALLOW_OUTPUT); return; }
    data = JSON.parse(input);
  } catch { console.log(ALLOW_OUTPUT); return; }

  const toolName = data.tool_name || data.toolName || '';
  const toolUseId = data.tool_use_id || data.toolUseId || '';

  // Respect tool allowlist/denylist
  if (TOOL_DENYLIST.has(toolName) || (TOOL_ALLOWLIST.size > 0 && !TOOL_ALLOWLIST.has(toolName))) {
    console.log(ALLOW_OUTPUT); return;
  }

  const toolInput = data.tool_input ?? data.toolInput ?? {};
  if (toolInput === null || typeof toolInput !== 'object') {
    console.log(ALLOW_OUTPUT); return;
  }

  const { result, repairs, notes } = repair(toolInput, toolName, 0);

  // Log telemetry + write state for PostToolUse hook (scoped by tool_use_id)
  if (repairs.length > 0 || notes.length > 0) {
    logTelemetry(repairs, toolName);
    writeState(repairs, notes, toolName, toolUseId);
  }

  if (repairs.length === 0) {
    console.log(ALLOW_OUTPUT); return;
  }

  // Build output — updatedInput for shape fixes, additionalContext for relational notes
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: result,
    }
  };

  if (notes.length > 0) {
    out.hookSpecificOutput.additionalContext = notes.join('\n');
  }

  console.log(JSON.stringify(out));
}

main().catch(() => { console.log(ALLOW_OUTPUT); });
