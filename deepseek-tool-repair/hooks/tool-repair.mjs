#!/usr/bin/env node
/**
 * Tool-Input Repair Layer — Awais Harness Methodology
 * ====================================================
 * Targeted repairs for model-generated tool inputs BEFORE they hit
 * Claude Code's internal validator.
 *
 * Six repair types, ordered carefully:
 *   1. null-for-optional      — strip `null`-valued optional keys
 *   2. stringified-array      — parse '["a","b"]' strings to real arrays
 *   3. markdown-autolink      — unwrap [path](url) degenerate auto-links
 *   4. wrapped-single-arg     — unwrap {single} to [single] for array fields
 *   5. bare-string-for-array  — wrap "foo" to ["foo"] for array fields
 *   6. relational-default     — fill missing offset/limit pairs
 *
 * Ordering constraint: repair 2 MUST run before repair 5, or
 *   '["a","b"]' would become ['["a","b"]'] (double-wrapped)
 *
 * Reference: Ahmad Awais (@MrAhmadAwais)
 *   https://x.com/MrAhmadAwais/status/2050956678502420612
 */

import { existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

const TELEMETRY_DIR = join(homedir(), '.omc', 'state', 'tool-repair');
const MAX_TELEMETRY_SIZE = 10 * 1024 * 1024; // 10MB

function ensureDir() {
  if (!existsSync(TELEMETRY_DIR)) {
    try { mkdirSync(TELEMETRY_DIR, { recursive: true }); } catch {}
  }
}

function logRepair(toolName, repairType, beforePreview, afterPreview) {
  ensureDir();
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    tool: toolName,
    repair: repairType,
    before: (beforePreview || '').slice(0, 200),
    after: (afterPreview || '').slice(0, 200),
  });
  const logPath = join(TELEMETRY_DIR, 'repairs.jsonl');
  try {
    if (existsSync(logPath) && statSync(logPath).size > MAX_TELEMETRY_SIZE) {
      renameSync(logPath, logPath + '.' + Date.now());
    }
    appendFileSync(logPath, entry + '\n');
  } catch {}
}

// ---------------------------------------------------------------------------
// Repair 1: null-for-optional
// ---------------------------------------------------------------------------

function repairNullOptional(obj) {
  if (!obj || typeof obj !== 'object') return { result: obj, repaired: false };
  if (Array.isArray(obj)) {
    let repaired = false;
    const fixed = obj.map(x => {
      if (x === null) { repaired = true; return undefined; }
      if (typeof x === 'object') { const s = repairNullOptional(x); if (s.repaired) repaired = true; return s.result; }
      return x;
    }).filter(x => x !== undefined);
    return { result: fixed, repaired };
  }

  let repaired = false;
  const cleaned = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      repaired = true;
      continue;
    }
    if (Array.isArray(value)) {
      const { result: arr, repaired: sub } = repairNullOptional(value);
      if (sub) repaired = true;
      cleaned[key] = arr;
    } else if (typeof value === 'object' && value !== null) {
      const { result, repaired: sub } = repairNullOptional(value);
      if (sub) repaired = true;
      cleaned[key] = result;
    } else {
      cleaned[key] = value;
    }
  }

  return { result: cleaned, repaired };
}

// Field blocklists — prevent content corruption
const NO_PARSE_FIELDS = new Set([
  'content', 'old_string', 'new_string', 'oldString', 'newString',
  'text', 'message', 'body', 'description', 'reason', 'prompt',
  'question', 'answer', 'summary', 'additionalContext', 'systemMessage',
  'command', 'script', 'query', 'regex', 'html', 'markdown',
]);
const NO_AUTOLINK_FIELDS = new Set([
  'content', 'old_string', 'new_string', 'oldString', 'newString',
  'message', 'reason', 'prompt', 'description', 'text', 'body',
  'question', 'answer', 'summary', 'additionalContext', 'systemMessage',
  'command', 'script', 'query',
]);

// ---------------------------------------------------------------------------
// Repair 2: stringified JSON arrays
// ---------------------------------------------------------------------------

function repairStringifiedArrays(obj) {
  if (!obj || typeof obj !== 'object') return { result: obj, repaired: false };

  if (Array.isArray(obj)) {
    let repaired = false;
    const fixed = obj.map(item => {
      const { result, repaired: sub } = repairStringifiedArrays(item);
      if (sub) repaired = true;
      return result;
    });
    return { result: fixed, repaired };
  }

  let repaired = false;
  const fixed = {};

  for (const [key, value] of Object.entries(obj)) {
    // Never parse content-bearing fields as JSON
    if (typeof value === 'string' && !NO_PARSE_FIELDS.has(key)) {
      const t = value.trim();
      // Case A: '["a","b"]' — stringified array
      if (t.startsWith('[') && t.endsWith(']')) {
        try {
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed)) {
            fixed[key] = parsed;
            repaired = true;
            continue;
          }
        } catch {}
      }
      // Case B: '"[\"a\",\"b\"]"' — double-encoded
      if (t.startsWith('"[') && t.endsWith(']"')) {
        // Strip outer quotes, then parse inner as JSON array
        const inner = t.slice(1, -1);
        try {
          const parsed = JSON.parse(inner);
          if (Array.isArray(parsed)) {
            fixed[key] = parsed;
            repaired = true;
            continue;
          }
        } catch {}
      }
    }

    if (typeof value === 'object' && value !== null) {
      const { result, repaired: sub } = repairStringifiedArrays(value);
      if (sub) repaired = true;
      fixed[key] = result;
    } else {
      fixed[key] = value;
    }
  }

  return { result: fixed, repaired };
}

// ---------------------------------------------------------------------------
// Repair 3: Markdown auto-link unwrap
// ---------------------------------------------------------------------------

const AUTOLINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;

// Known path-like field names (pathString schema hints)
const PATH_FIELDS = new Set([
  'file_path', 'filePath', 'path', 'absolutePath', 'relativePath',
  'directory', 'workingDirectory', 'output', 'outputPath',
  'working_directory', 'file', 'target', 'source',
  'config_path', 'log_path', 'state_path', 'plugin_root',
]);

function isPathField(key) {
  return PATH_FIELDS.has(key);
}

// Global regex — replaces ALL degenerate auto-links, not just the first
const AUTOLINK_RE_G = /\[([^\]]+)\]\(([^)]+)\)/g;

function repairAutoLink(str) {
  if (typeof str !== 'string') return { result: str, repaired: false };

  let ok = false;
  let result = str;

  const matches = [...str.matchAll(AUTOLINK_RE_G)];
  if (matches.length === 0) return { result: str, repaired: false };

  // Process in reverse to preserve indices
  for (const m of matches.reverse()) {
    const [full, text, url] = m;
    const noProto = url.replace(/^https?:\/\//, '');
    // Only unwrap when link text IS the URL path (degenerate auto-link)
    if (text === noProto || text === url) {
      result = result.substring(0, m.index) + text + result.substring(m.index + full.length);
      ok = true;
    }
  }

  return { result, repaired: ok };
}

function repairMarkdownAutoLinks(obj) {
  if (!obj || typeof obj !== 'object') return { result: obj, repaired: false };
  if (Array.isArray(obj)) {
    let repaired = false;
    const fixed = obj.map(x => {
      if (typeof x === 'string') { const s = repairAutoLink(x); if (s.repaired) repaired = true; return s.result; }
      if (typeof x === 'object' && x !== null) { const s = repairMarkdownAutoLinks(x); if (s.repaired) repaired = true; return s.result; }
      return x;
    });
    return { result: fixed, repaired };
  }

  let repaired = false;
  const fixed = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && !NO_AUTOLINK_FIELDS.has(key)) {
      const { result, repaired: sub } = repairAutoLink(value);
      if (sub) {
        fixed[key] = result;
        repaired = true;
        continue;
      }
    }

    if (typeof value === 'object' && value !== null) {
      const { result, repaired: sub } = repairMarkdownAutoLinks(value);
      if (sub) repaired = true;
      fixed[key] = result;
    } else {
      fixed[key] = value;
    }
  }

  return { result: fixed, repaired };
}

// ---------------------------------------------------------------------------
// Repair 4 & 5: Array field fixes
// ---------------------------------------------------------------------------

// Fields known to expect array values
const ARRAY_FIELDS = new Set([
  'args', 'file_paths', 'patterns',
  'serverAddresses', 'aggregatedPackageFullNames', 'tags',
  'files', 'paths', 'commands',
  'globs', 'ignore', 'include', 'exclude',
]);

function isArrayField(key) {
  return ARRAY_FIELDS.has(key);
}

function repairWrappedSingleArg(obj) {
  if (!obj || typeof obj !== 'object') return { result: obj, repaired: false };
  if (Array.isArray(obj)) return { result: obj, repaired: false };

  let repaired = false;
  const fixed = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isArrayField(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const vKeys = Object.keys(value);
      if (vKeys.length === 1) {
        fixed[key] = [value[vKeys[0]]];
        repaired = true;
        continue;
      }
      if (vKeys.length === 0) {
        fixed[key] = [];
        repaired = true;
        continue;
      }
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const { result, repaired: sub } = repairWrappedSingleArg(value);
      if (sub) repaired = true;
      fixed[key] = result;
    } else {
      fixed[key] = value;
    }
  }

  return { result: fixed, repaired };
}

function repairBareStringForArray(obj) {
  if (!obj || typeof obj !== 'object') return { result: obj, repaired: false };
  if (Array.isArray(obj)) return { result: obj, repaired: false };

  let repaired = false;
  const fixed = {};

  for (const [key, value] of Object.entries(obj)) {
    // Don't wrap empty strings — model likely meant something else
    if (isArrayField(key) && typeof value === 'string' && value.length > 0) {
      fixed[key] = [value];
      repaired = true;
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      const { result, repaired: sub } = repairBareStringForArray(value);
      if (sub) repaired = true;
      fixed[key] = result;
    } else {
      fixed[key] = value;
    }
  }

  return { result: fixed, repaired };
}

// ---------------------------------------------------------------------------
// Repair 6: Relational invariant defaults (Read tool)
// ---------------------------------------------------------------------------

const READ_TOOLS = new Set(['Read', 'read', 'read_file', 'readFile']);

function repairReadRelational(obj, toolName) {
  if (!READ_TOOLS.has(toolName)) return { result: obj, repaired: false };
  if (!obj || typeof obj !== 'object') return { result: obj, repaired: false };

  let repaired = false;
  const fixed = { ...obj };

  const offset = fixed.offset ?? fixed.offset_value;
  const limit = fixed.limit ?? fixed.limit_value;

  if (offset !== undefined && limit === undefined) {
    fixed.limit = 2000;
    repaired = true;
  }

  if (limit !== undefined && offset === undefined) {
    fixed.offset = 0;
    repaired = true;
  }

  return { result: fixed, repaired };
}

// ---------------------------------------------------------------------------
// Master pipeline — ORDER MATTERS
// ---------------------------------------------------------------------------

function repairToolInput(toolInput, toolName) {
  if (!toolInput || typeof toolInput !== 'object') {
    return { result: toolInput, repairs: [] };
  }

  const repairs = [];
  let current = toolInput;

  // Step 1: null-for-optional
  const r1 = repairNullOptional(current);
  if (r1.repaired) { repairs.push('null-for-optional'); current = r1.result; }

  // Step 2: stringified JSON arrays — MUST run before step 5
  const r2 = repairStringifiedArrays(current);
  if (r2.repaired) { repairs.push('stringified-array'); current = r2.result; }

  // Step 3: markdown auto-link unwrap
  const r3 = repairMarkdownAutoLinks(current);
  if (r3.repaired) { repairs.push('markdown-autolink'); current = r3.result; }

  // Step 4: unwrap single-arg-in-object for array fields
  const r4 = repairWrappedSingleArg(current);
  if (r4.repaired) { repairs.push('wrapped-single-arg'); current = r4.result; }

  // Step 5: bare string → array — MUST run AFTER step 2
  const r5 = repairBareStringForArray(current);
  if (r5.repaired) { repairs.push('bare-string-for-array'); current = r5.result; }

  // Step 6: relational defaults
  const r6 = repairReadRelational(current, toolName);
  if (r6.repaired) { repairs.push('relational-default'); current = r6.result; }

  // Log telemetry
  if (repairs.length > 0) {
    logRepair(
      toolName,
      repairs.join('+'),
      JSON.stringify(toolInput).slice(0, 200),
      JSON.stringify(current).slice(0, 200)
    );
  }

  return { result: current, repairs };
}

// ---------------------------------------------------------------------------
// Stats — read repair telemetry
// ---------------------------------------------------------------------------

function repairStats(daysBack = 7) {
  ensureDir();
  const logPath = join(TELEMETRY_DIR, 'repairs.jsonl');
  if (!existsSync(logPath)) return { total: 0, byRepair: {}, byTool: {} };

  try {
    const { readFileSync } = awaitFs();
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const cutoff = Date.now() - daysBack * 86400000;

    const stats = { total: 0, byRepair: {}, byTool: {}, recent: [] };

    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        const ts = new Date(e.ts).getTime();
        if (isNaN(ts) || ts < cutoff) continue;

        stats.total++;
        const repairs = e.repair.split('+');
        for (const r of repairs) {
          stats.byRepair[r] = (stats.byRepair[r] || 0) + 1;
        }
        stats.byTool[e.tool] = (stats.byTool[e.tool] || 0) + 1;
        if (stats.recent.length < 10) stats.recent.push(e);
      } catch {}
    }

    return stats;
  } catch {
    return { total: 0, byRepair: {}, byTool: {} };
  }
}

// Lazy import for stats
async function awaitFs() {
  return await import('fs');
}

export {
  repairToolInput,
  repairNullOptional,
  repairStringifiedArrays,
  repairMarkdownAutoLinks,
  repairAutoLink,
  repairWrappedSingleArg,
  repairBareStringForArray,
  repairReadRelational,
  repairStats,
  logRepair,
  isPathField,
  isArrayField,
  TELEMETRY_DIR,
};
