'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const cliPath = path.join(__dirname, '..', 'bin', 'sri-verify.js');

function runCli(manifest, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sri-'));
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return spawnSync(process.execPath, [cliPath, ...extraArgs, file], { encoding: 'utf8' });
}

test('CLI exits zero and prints PASSED for a clean manifest', () => {
  const body = 'console.log("cli")';
  const digest = createHash('sha256').update(body).digest('base64');
  const result = runCli({
    url: 'https://example.test/',
    html: `<script src="app.js" integrity="sha256-${digest}"></script>`,
    resources: { 'https://example.test/app.js': { body } },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /SRI verification: PASSED/);
});

test('CLI exits one for a failed manifest and supports JSON output', () => {
  const result = runCli({
    url: 'https://example.test/',
    html: '<script src="app.js"></script>',
    resources: { 'https://example.test/app.js': { body: 'x' } },
  }, ['--json']);

  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, 'failed');
  assert.ok(parsed.errors.some((error) => error.code === 'MISSING_INTEGRITY'));
});

test('CLI exits two when the manifest file cannot be read', () => {
  const result = spawnSync(process.execPath, [cliPath, path.join(os.tmpdir(), 'missing-sri.json')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
});
