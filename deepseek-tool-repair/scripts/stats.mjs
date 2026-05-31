#!/usr/bin/env node
/**
 * Tool-Input Repair Stats Viewer
 * ==============================
 * Shows per-tool and per-repair-type statistics.
 *
 * Usage:
 *   node .omc/hooks/tool-repair-stats.mjs          # last 7 days
 *   node .omc/hooks/tool-repair-stats.mjs 30       # last 30 days
 *   node .omc/hooks/tool-repair-stats.mjs --live   # tail the repair log
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TELEMETRY_DIR = join(homedir(), '.omc', 'state', 'tool-repair');
const LOG_PATH = join(TELEMETRY_DIR, 'repairs.jsonl');

const daysBack = parseInt(process.argv[2]) || (process.argv.includes('--all') ? 365 : 7);
const liveMode = process.argv.includes('--live');

function readRepairs() {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const text = readFileSync(LOG_PATH, 'utf-8');
    return text.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function printStats() {
  const repairs = readRepairs();
  const cutoff = Date.now() - daysBack * 86400000;

  const recent = repairs.filter(r => {
    const ts = new Date(r.ts).getTime();
    return !isNaN(ts) && ts >= cutoff;
  });

  if (recent.length === 0) {
    console.log('\n  No repairs recorded in the last ' + daysBack + ' days.');
    console.log('  This is GOOD — it means model tool calls are clean.\n');
    return;
  }

  console.log('\n🔧 Tool-Input Repair Stats (last ' + daysBack + ' days)');
  console.log('='.repeat(60));
  console.log('Total repairs: ' + recent.length + '\n');

  // By repair type
  const byRepair = {};
  for (const r of recent) {
    const types = r.repair.split('+');
    for (const t of types) {
      byRepair[t] = (byRepair[t] || 0) + 1;
    }
  }

  console.log('By repair type:');
  const maxRepair = Math.max(...Object.values(byRepair));
  for (const [type, count] of Object.entries(byRepair).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.round(count / maxRepair * 30));
    console.log('  ' + type.padEnd(22) + ' ' + bar + ' ' + count);
  }

  // By tool
  const byTool = {};
  for (const r of recent) {
    byTool[r.tool] = (byTool[r.tool] || 0) + 1;
  }

  console.log('\nBy tool:');
  const maxTool = Math.max(...Object.values(byTool));
  for (const [tool, count] of Object.entries(byTool).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.round(count / maxTool * 30));
    console.log('  ' + tool.padEnd(22) + ' ' + bar + ' ' + count);
  }

  console.log('\nRecent repairs (last 10):');
  for (const r of recent.slice(-10)) {
    console.log('  [' + r.ts + '] ' + r.tool + ': ' + r.repair);
    console.log('    before: ' + r.before);
  }
  console.log('');
}

if (liveMode) {
  // Tail mode — keep watching the log
  console.log('Watching repair log (Ctrl+C to stop)...\n');
  let lastSize = existsSync(LOG_PATH) ? statSync(LOG_PATH).size : 0;

  setInterval(() => {
    try {
      if (!existsSync(LOG_PATH)) return;
      const currentSize = statSync(LOG_PATH).size;
      if (currentSize > lastSize) {
        const stream = readFileSync(LOG_PATH, 'utf-8');
        const lines = stream.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim()) {
            const r = JSON.parse(lines[i]);
            console.log('[' + r.ts + '] ' + r.tool + ': ' + r.repair);
            break;
          }
        }
        lastSize = currentSize;
      }
    } catch {}
  }, 2000);
} else {
  printStats();
}
