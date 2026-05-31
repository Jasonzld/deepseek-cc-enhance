#!/usr/bin/env node
/**
 * Tool-Input Repair Layer — Test Suite (Adversarial Edition)
 * ==========================================================
 * Covers: happy path, edge cases, content protection,
 *         nested repairs, adversarial inputs, ordering constraints.
 */

import { repairToolInput } from '../hooks/tool-repair.mjs';

let passed = 0;
let failed = 0;

function test(name, input, tool, expected, desc) {
  const { result, repairs } = repairToolInput(input, tool);
  const rj = JSON.stringify(result);
  const ej = JSON.stringify(expected);
  if (rj === ej) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    Input:    ${JSON.stringify(input)}`);
    console.log(`    Expected: ${ej}`);
    console.log(`    Got:      ${rj}`);
    console.log(`    Repairs:  ${repairs.join(', ') || 'none'}`);
    console.log(`    ${desc}`);
  }
}

// =========================================================================
// Repair 1: null-for-optional
// =========================================================================
console.log('\n=== Repair 1: null-for-optional ===\n');

test('Strips null optional field',
  { file_path: '/test', limit: null, description: 'hello' }, 'Read',
  { file_path: '/test', description: 'hello' }, '');

test('Preserves non-null values',
  { file_path: '/test', limit: 30, offset: 0 }, 'Read',
  { file_path: '/test', limit: 30, offset: 0 }, '');

test('B1: Recurses into arrays — strips null from array elements',
  { items: [{ name: 'a', extra: null }, { name: 'b' }] }, 'Write',
  { items: [{ name: 'a' }, { name: 'b' }] }, 'null inside array objects must be stripped');

test('B2: Handles null elements directly in array',
  { paths: ['/a', null, '/b'] }, 'Bash',
  { paths: ['/a', '/b'] }, 'null elements in array removed');

test('B3: Deeply nested null in array of arrays',
  { matrix: [[{ x: 1, y: null }]] }, 'Bash',
  { matrix: [[{ x: 1 }]] }, 'deeply nested null removal');

// =========================================================================
// Repair 2: stringified JSON arrays
// =========================================================================
console.log('\n=== Repair 2: stringified JSON arrays ===\n');

test('Parses stringified array',
  { args: '["--verbose", "--output", "dir"]' }, 'Bash',
  { args: ['--verbose', '--output', 'dir'] }, '');

test('Parses double-encoded stringified array',
  { patterns: '"[\"*.ts\",\"*.js\"]"' }, 'Glob',
  { patterns: ['*.ts', '*.js'] }, '');

test('Leaves real arrays untouched',
  { args: ['--verbose'] }, 'Bash',
  { args: ['--verbose'] }, '');

test('B4: Non-array JSON string wrapped per Awais repair 5',
  { args: '{"key": "value"}' }, 'Bash',
  { args: ['{"key": "value"}'] }, 'bare string for array field must be wrapped — shape repair over content guess');

// =========================================================================
// Repair 3: Markdown auto-link unwrap
// =========================================================================
console.log('\n=== Repair 3: Markdown auto-link unwrap ===\n');

test('Unwraps [path](http://path) auto-link',
  { file_path: '/Users/x/proj/[notes.md](http://notes.md)' }, 'Write',
  { file_path: '/Users/x/proj/notes.md' }, '');

test('Preserves real markdown [click](https://x.com)',
  { description: 'see [the docs](https://example.com) for info' }, 'Write',
  { description: 'see [the docs](https://example.com) for info' }, '');

test('Unwraps [file.md](http://file.md) with matching text',
  { file_path: '/src/[app.ts](http://app.ts)' }, 'Read',
  { file_path: '/src/app.ts' }, '');

test('B5: Unwraps multiple auto-links in same string',
  { file_path: '/src/[a.md](http://a.md)/lib/[b.ts](http://b.ts)' }, 'Read',
  { file_path: '/src/a.md/lib/b.ts' }, 'ALL auto-links must be unwrapped, not just the first');

// =========================================================================
// Repair 4: wrapped single arg
// =========================================================================
console.log('\n=== Repair 4: wrapped single arg ===\n');

test('Unwraps single-key object to array',
  { args: { command: 'npm test' } }, 'Bash',
  { args: ['npm test'] }, '');

test('Leaves multi-key objects alone',
  { args: { command: 'npm', subcommand: 'test' } }, 'Bash',
  { args: { command: 'npm', subcommand: 'test' } }, '');

// =========================================================================
// Repair 5: bare string for array
// =========================================================================
console.log('\n=== Repair 5: bare string for array ===\n');

test('Wraps bare string in array',
  { args: 'npm install' }, 'Bash',
  { args: ['npm install'] }, '');

test('Ordering: stringified-array before bare-string',
  { args: '["a","b"]' }, 'Bash',
  { args: ['a', 'b'] }, 'stringified-array parses before bare-string-wrap fires');

test('B6: Empty string NOT wrapped',
  { args: '' }, 'Bash',
  { args: '' }, 'empty string should not become [""] — model likely made an error');

// =========================================================================
// Repair 6: Relational invariant defaults
// =========================================================================
console.log('\n=== Repair 6: Relational invariant defaults ===\n');

test('Fills limit when only offset given',
  { file_path: '/test', offset: 100 }, 'Read',
  { file_path: '/test', offset: 100, limit: 2000 }, '');

test('Fills offset when only limit given',
  { file_path: '/test', limit: 30 }, 'Read',
  { file_path: '/test', limit: 30, offset: 0 }, '');

test('Leaves complete pairs untouched',
  { file_path: '/test', offset: 10, limit: 50 }, 'Read',
  { file_path: '/test', offset: 10, limit: 50 }, '');

test('B7: Does NOT apply to non-Read tools',
  { file_path: '/test', offset: 100 }, 'Write',
  { file_path: '/test', offset: 100 }, 'Write tool should not get read defaults');

test('B8: offset=0 is a real value',
  { file_path: '/test', offset: 0 }, 'Read',
  { file_path: '/test', offset: 0, limit: 2000 }, 'offset=0 is valid — read from start');

// =========================================================================
// Content field protection
// =========================================================================
console.log('\n=== Content field protection ===\n');

test('C1: Write content with JSON array string NOT parsed',
  { file_path: '/test.json', content: '["item1", "item2"]' }, 'Write',
  { file_path: '/test.json', content: '["item1", "item2"]' }, '');

test('C2: Write content with auto-link NOT unwrapped',
  { file_path: '/readme.md', content: 'see [the docs](http://docs.example.com)' }, 'Write',
  { file_path: '/readme.md', content: 'see [the docs](http://docs.example.com)' }, '');

test('C3: Edit old/new strings NOT parsed',
  { file_path: '/test.ts', old_string: '["a","b"]', new_string: '["c","d"]' }, 'Edit',
  { file_path: '/test.ts', old_string: '["a","b"]', new_string: '["c","d"]' }, '');

test('C4: Shell args field still repaired',
  { args: '["--verbose"]' }, 'Bash',
  { args: ['--verbose'] }, 'non-content fields still repaired');

// =========================================================================
// Composite / nested repairs
// =========================================================================
console.log('\n=== Composite / nested repairs ===\n');

test('N1: null + stringified-array in same object',
  { file_path: '/test', extra: null, args: '["a","b"]' }, 'Bash',
  { file_path: '/test', args: ['a', 'b'] }, 'two different repairs in one object');

test('N2: Deeply nested repairs',
  { config: { tools: { extra: null, patterns: '["*.ts","*.js"]' } } }, 'Bash',
  { config: { tools: { patterns: ['*.ts', '*.js'] } } }, 'repairs recurse into nested objects');

// =========================================================================
// Edge cases
// =========================================================================
console.log('\n=== Edge cases ===\n');

test('Null input', null, 'Bash', null, '');
test('Empty object', {}, 'Bash', {}, '');
test('Non-object string', 'simple string', 'Write', 'simple string', '');
test('Array top-level input', ['a', 'b'], 'Bash', ['a', 'b'], '');

// =========================================================================
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed === 0) console.log('ALL TESTS PASSED ✓');
else { console.log(`${failed} TEST(S) FAILED ✗`); process.exit(1); }
