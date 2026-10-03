import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { makeTgz } from '../examples/leaky-app/tar.js';
import { explainBytes, explainFile } from '../src/explain/index.js';
import { ctx, makeZip } from './helpers.js';

const ids = (causes) => causes.map((c) => c.id).sort();
const buf = (s) => Buffer.from(s, 'latin1');

test('detects embedded absolute build path', () => {
  const a = buf(`const root = "${ctx.rootA}/src";`);
  const b = buf(`const root = "${ctx.rootB}/src";`);
  assert.deepEqual(ids(explainBytes(a, b, ctx)), ['build-path']);
});

test('detects ISO timestamps that differ, ignores ones that match', () => {
  const a = buf('built 2026-01-01T00:00:03.123Z fixed 2020-01-01T00:00:00Z');
  const b = buf('built 2026-01-01T00:00:09.456Z fixed 2020-01-01T00:00:00Z');
  const causes = explainBytes(a, b, ctx);
  assert.deepEqual(ids(causes), ['timestamp']);
  assert.equal(causes[0].count, 2);
});

test('identical timestamps are not a cause', () => {
  const a = buf('built 2020-01-01T00:00:00Z x');
  const b = buf('built 2020-01-01T00:00:00Z y');
  assert.deepEqual(ids(explainBytes(a, b, ctx)), ['unexplained']);
});

test('detects epoch seconds and millis inside the run window', () => {
  const secA = Math.floor(ctx.runA.startedAt / 1000) + 2;
  const secB = Math.floor(ctx.runB.startedAt / 1000) + 2;
  assert.deepEqual(ids(explainBytes(buf(`t=${secA}`), buf(`t=${secB}`), ctx)), ['timestamp']);
  const msA = ctx.runA.startedAt + 2000;
  const msB = ctx.runB.startedAt + 2000;
  assert.deepEqual(ids(explainBytes(buf(`t=${msA}`), buf(`t=${msB}`), ctx)), ['timestamp']);
});

test('ignores 10-digit numbers outside the run window', () => {
  const r = explainBytes(buf('n=1111111111'), buf('n=1111111112'), ctx);
  assert.deepEqual(ids(r), ['unexplained']);
});

test('detects UUIDs and long hex ids', () => {
  const a = buf('id=3f2504e0-4f89-41d3-9a0c-0305e82c3301 h=0123456789abcdef');
  const b = buf('id=9b2504e0-4f89-41d3-9a0c-0305e82c3302 h=fedcba9876543210');
  assert.deepEqual(ids(explainBytes(a, b, ctx)), ['random-id']);
});

test('detects reordered JSON keys and reordered lines', () => {
  assert.deepEqual(ids(explainBytes(buf('{"a":1,"b":2}'), buf('{"b":2,"a":1}'), ctx)), [
    'ordering',
  ]);
  assert.deepEqual(ids(explainBytes(buf('x\ny\nz\n'), buf('z\nx\ny\n'), ctx)), ['ordering']);
});

test('reports multiple causes in one file', () => {
  const a = buf(`${ctx.rootA} 2026-01-01T00:00:03Z`);
  const b = buf(`${ctx.rootB} 2026-01-01T00:00:09Z`);
  assert.deepEqual(ids(explainBytes(a, b, ctx)), ['build-path', 'timestamp']);
});

test('falls back to unexplained with a diff sample', () => {
  const [c] = explainBytes(buf('hello world'), buf('hello there'), ctx);
  assert.equal(c.id, 'unexplained');
  assert.match(c.samples[0].a, /world/);
});

test('tar: mtime, order, owner and gzip header', () => {
  const e = (name, mtime) => ({ name, data: Buffer.from(name), mtime });
  const a = makeTgz([e('a.txt', 1000), e('b.txt', 1000)]);
  const b = makeTgz([e('b.txt', 2000), e('a.txt', 2000)]);
  const r = ids(explainFile('x.tgz', a, b, ctx));
  assert.deepEqual(r, ['archive-mtime', 'archive-order']);
  const gz = Buffer.from(a);
  gz.writeUInt32LE(12345, 4);
  assert.ok(ids(explainFile('x.tgz', a, gz, ctx)).includes('gzip-header'));
});

test('tar: explains differing content of entries', () => {
  const a = makeTgz([{ name: 'v.txt', data: Buffer.from('built 2026-01-01T00:00:03Z'), mtime: 5 }]);
  const b = makeTgz([{ name: 'v.txt', data: Buffer.from('built 2026-01-01T00:00:09Z'), mtime: 5 }]);
  const causes = explainFile('x.tgz', a, b, ctx);
  assert.deepEqual(ids(causes), ['timestamp']);
  assert.match(causes[0].samples[0].where, /x\.tgz!v\.txt/);
});

test('tar: identical entries but different compression is flagged honestly', () => {
  const raw = zlib.gunzipSync(makeTgz([{ name: 'a', data: Buffer.from('aaaa'), mtime: 1 }]));
  const a = zlib.gzipSync(raw, { level: 1 });
  const b = zlib.gzipSync(raw, { level: 9 });
  if (a.equals(b)) return; // tiny input may compress identically
  const [c] = explainFile('x.tgz', a, b, ctx);
  assert.equal(c.id, 'unexplained');
  assert.match(c.samples[0].b, /compressor/);
});

test('zip: dos mtime and order', () => {
  const e = (name, mtime) => ({ name, data: Buffer.from(`data-${name}`), mtime });
  const a = makeZip([e('a', 1_700_000_000), e('b', 1_700_000_000)]);
  const b = makeZip([e('b', 1_700_000_100), e('a', 1_700_000_100)]);
  assert.deepEqual(ids(explainFile('x.zip', a, b, ctx)), ['archive-mtime', 'archive-order']);
});

test('corrupt archive falls back to byte analysis instead of throwing', () => {
  const r = explainFile('x.zip', Buffer.from('not a zip A'), Buffer.from('not a zip B'), ctx);
  assert.deepEqual(ids(r), ['unexplained']);
});
