#!/usr/bin/env node
/**
 * DeepSeek Tool-Repair Harness — One-Command Deploy
 * =================================================
 * Idempotent. Cross-platform. Registers PreToolUse + PostToolUseFailure hooks.
 * v2.0: backup, rollback, dry-run, integrity check, proper uninstall.
 *
 * Usage: node setup.mjs [--uninstall] [--dry-run] [--backup DIR]
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync,
  unlinkSync, rmdirSync, readdirSync, statSync
} from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { homedir, platform, tmpdir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = resolve(dirname(__dirname));
const HOME = homedir();
const HOOKS_SRC = join(SKILL_ROOT, 'hooks');
const SETTINGS_FILE = join(HOME, '.claude', 'settings.local.json');
const STATE_DIR = join(HOME, '.omc', 'state', 'tool-repair');
const BACKUP_DIR = join(HOME, '.claude', 'backups');

const isDryRun = process.argv.includes('--dry-run');
const isUninstall = process.argv.includes('--uninstall');
const isPosix = platform() !== 'win32';

// Absolute paths for hook scripts
const toSettingsPath = (p) => p.replace(/\\/g, '/');

function log(msg) { if (isDryRun) console.log('  [DRY-RUN] ' + msg); else console.log('  ' + msg); }

console.log('\n' + (isUninstall ? '🗑  Uninstalling' : '🔧 Installing') + ' DeepSeek Tool-Repair Harness' + (isDryRun ? ' (dry-run)' : '') + '\n');

// Step 0: Node version check
console.log('[0/5] Checking Node.js version...');
const nodeVer = process.version;
const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
if (major < 18) { console.log('  ✗ Node.js 18+ required, got ' + nodeVer); process.exit(1); }
log('✓ ' + nodeVer + ' OK');

// Step 1: Verify files
console.log('[1/5] Verifying hook scripts...');
const hookFiles = ['tool-repair-prehook.mjs', 'tool-repair-postfailure.mjs'];
for (const f of hookFiles) {
  if (existsSync(join(HOOKS_SRC, f))) log('✓ ' + f);
  else { console.log('  ✗ MISSING: ' + f); process.exit(1); }
}

// Step 2: State directory
console.log('[2/5] State directory...');
if (!isDryRun) {
  try { mkdirSync(STATE_DIR, { recursive: true }); log('✓ ' + STATE_DIR); }
  catch(e) { console.log('  ⚠ ' + e.message); }
} else { log('(skipped)'); }

// Step 3: Backup + Register/Unregister hooks
console.log('[3/5] ' + (isUninstall ? 'Removing' : 'Registering') + ' hooks...');

try {
  const settingsDir = dirname(SETTINGS_FILE);
  if (!existsSync(settingsDir) && !isDryRun) mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (existsSync(SETTINGS_FILE)) {
    try { settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')); }
    catch(e) { console.log('  ✗ Settings corrupted. Aborting.'); process.exit(1); }
  }

  // Backup before modify
  if (!isDryRun && !isUninstall && Object.keys(settings).length > 0) {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
    const backupPath = join(BACKUP_DIR, 'settings.local.json.' + Date.now() + '.bak');
    writeFileSync(backupPath, JSON.stringify(settings, null, 2));
    log('✓ Backup: ' + backupPath);
  }

  if (!settings.hooks) settings.hooks = {};

  // Define tool allowlist config (injected into prehook at runtime)
  // Reminder: edit tool-repair-prehook.mjs TOOL_ALLOWLIST/TOOL_DENYLIST to scope repairs

  for (const event of ['PreToolUse', 'PostToolUseFailure']) {
    if (!settings.hooks[event]) settings.hooks[event] = [];

    const hookPath = event === 'PreToolUse'
      ? join(HOOKS_SRC, 'tool-repair-prehook.mjs')
      : join(HOOKS_SRC, 'tool-repair-postfailure.mjs');
    const hookBasename = event === 'PreToolUse' ? 'tool-repair-prehook.mjs' : 'tool-repair-postfailure.mjs';
    const settingsPath = toSettingsPath(hookPath);

    if (isUninstall) {
      const before = settings.hooks[event].length;
      settings.hooks[event] = settings.hooks[event].filter(
        entry => !entry.hooks?.some(h => h.command?.includes(hookBasename))
      );
      if (settings.hooks[event].length < before) log('✓ ' + event + ' removed');
      else log('✓ ' + event + ' not found (already removed)');
    } else {
      const exists = settings.hooks[event].some(
        entry => entry.hooks?.some(h => h.command?.includes(hookBasename))
      );
      if (!exists) {
        settings.hooks[event].push({
          matcher: '*',
          hooks: [{ type: 'command', command: 'node "' + settingsPath + '"', timeout: 10 }],
        });
        log('✓ ' + event + ' registered');
      } else {
        log('✓ ' + event + ' already registered');
      }
    }
  }

  if (!isDryRun) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    log('✓ Settings saved');
  }
} catch(e) { console.log('  ✗ Failed: ' + e.message); }

// Step 4: Run tests
if (!isUninstall) {
  console.log('[4/5] Running test suite...');
  try {
    const testPath = join(SKILL_ROOT, 'tests', 'tool-repair-test.mjs');
    const result = execSync('node "' + testPath + '"', { encoding: 'utf-8', timeout: 15000 });
    const lines = result.split('\n');
    console.log(lines[lines.length - 4] || '');
    console.log(lines[lines.length - 3] || '');
  } catch(e) {
    console.log('  ⚠ Tests: ' + (e.stdout ? e.stdout.slice(-200) : e.message));
  }
} else { console.log('[4/5] Skipped (uninstall)\n'); }

// Step 5: Integrity check
console.log('[5/5] Integrity check...');
let ok = true;
for (const f of hookFiles) {
  if (!existsSync(join(HOOKS_SRC, f))) { console.log('  ✗ Missing: ' + f); ok = false; }
}
if (ok) log('✓ All hook files present');
else { console.log('  ⚠ Re-run setup to restore missing files'); }

// Rollback hint
console.log('\nBackup at: ' + BACKUP_DIR);
console.log('Rollback:   copy a .bak file back to settings.local.json\n');

if (isUninstall) console.log('  ✓ Uninstalled. Manually remove: ' + STATE_DIR + ' and ' + SKILL_ROOT + '\n');
