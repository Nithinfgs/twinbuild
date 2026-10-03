import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tmpProject } from './helpers.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/twinbuild.js');
const run = (cwd, args) =>
  spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });

const NODE = process.execPath;

test('deterministic build exits 0', () => {
  const dir = tmpProject({
    'build.js': `require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/a.txt','hi')`,
  });
  const r = run(dir, ['--json', '--', NODE, 'build.js']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.reproducible, true);
  assert.equal(j.summary.total, 1);
});

test('time and path leaks exit 1 and are attributed', () => {
  const dir = tmpProject({
    'build.js': `const fs=require('fs');fs.mkdirSync('out',{recursive:true});
fs.writeFileSync('out/v.txt','at '+new Date().toISOString()+' in '+process.cwd());`,
  });
  const r = run(dir, ['--json', '--', NODE, 'build.js']);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.causes.map((c) => c.id).sort(), ['build-path', 'timestamp']);
  assert.ok(!JSON.stringify(j.files).includes('/private/var'), 'temp prefix should be tidied');
});

test('--source-date-epoch makes a cooperative build reproducible', () => {
  const dir = tmpProject({
    'build.js': `const fs=require('fs');fs.mkdirSync('out',{recursive:true});
const t=process.env.SOURCE_DATE_EPOCH?new Date(process.env.SOURCE_DATE_EPOCH*1000):new Date();
fs.writeFileSync('out/v.txt','at '+t.toISOString());`,
  });
  assert.equal(run(dir, ['--', NODE, 'build.js']).status, 1);
  assert.equal(run(dir, ['--source-date-epoch', '--', NODE, 'build.js']).status, 0);
});

test('timezone dependent output is caught', () => {
  const dir = tmpProject({
    'build.js': `const fs=require('fs');fs.mkdirSync('out',{recursive:true});
fs.writeFileSync('out/v.txt',new Date(0).getHours()+'h');`,
  });
  assert.equal(run(dir, ['--', NODE, 'build.js']).status, 1);
  assert.equal(run(dir, ['--tz', 'same', '--', NODE, 'build.js']).status, 0);
});

test('--out limits comparison and --ignore skips files', () => {
  const dir = tmpProject({
    'build.js': `const fs=require('fs');fs.mkdirSync('out',{recursive:true});fs.mkdirSync('logs',{recursive:true});
fs.writeFileSync('out/a.txt','same');fs.writeFileSync('logs/t.txt',String(Math.random()));`,
  });
  assert.equal(run(dir, ['--', NODE, 'build.js']).status, 1);
  assert.equal(run(dir, ['--out', 'out', '--', NODE, 'build.js']).status, 0);
  assert.equal(run(dir, ['--ignore', 'logs', '--', NODE, 'build.js']).status, 0);
});

test('failing build exits 2 with the log tail', () => {
  const dir = tmpProject({ 'build.js': `console.error('boom happened');process.exit(3)` });
  const r = run(dir, ['--', NODE, 'build.js']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /boom happened/);
});

test('missing command and unknown flag exit 2', () => {
  const dir = tmpProject({ 'x.txt': 'x' });
  assert.equal(run(dir, []).status, 2);
  assert.equal(run(dir, ['--nope', '--', 'true']).status, 2);
});

test('writes an HTML report and does not touch the original project', () => {
  const dir = tmpProject({
    'build.js': `const fs=require('fs');fs.mkdirSync('out',{recursive:true});fs.writeFileSync('out/r.txt',String(Math.random()))`,
  });
  const html = path.join(dir, 'report.html');
  const before = fs.readdirSync(dir).sort();
  const r = run(dir, ['--html', html, '--', NODE, 'build.js']);
  assert.equal(r.status, 1);
  assert.match(fs.readFileSync(html, 'utf8'), /Not reproducible/);
  assert.deepEqual(
    fs
      .readdirSync(dir)
      .filter((f) => f !== 'report.html')
      .sort(),
    before,
  );
});

test('--help and --version', () => {
  assert.match(run(process.cwd(), ['--help']).stdout, /Usage/);
  assert.match(run(process.cwd(), ['--version']).stdout, /^\d+\.\d+\.\d+/);
});

test('example projects behave as documented', () => {
  const root = path.resolve(path.dirname(bin), '..', 'examples');
  const npm = ['--', 'node', 'build.js'];
  const leaky = run(path.join(root, 'leaky-app'), ['--json', ...npm]);
  assert.equal(leaky.status, 1, leaky.stderr);
  const ids = JSON.parse(leaky.stdout).causes.map((c) => c.id);
  for (const want of [
    'build-path',
    'timestamp',
    'random-id',
    'ordering',
    'archive-order',
    'archive-mtime',
    'hashed-filename',
  ]) {
    assert.ok(ids.includes(want), `leaky-app should report ${want}, got ${ids}`);
  }
  assert.equal(run(path.join(root, 'fixed-app'), npm).status, 0);
});

test('real C toolchain: __DATE__/__TIME__ is attributed (skipped without cc/make)', (t) => {
  const have = (c) => spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0;
  if (!have('cc') || !have('make')) return t.skip('cc or make not available');
  const dir = path.resolve(path.dirname(bin), '..', 'examples', 'c-timestamp');
  const r = run(dir, ['--json', '--', 'make']);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(JSON.parse(r.stdout).causes.some((c) => c.id === 'timestamp'));
});
