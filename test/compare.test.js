import assert from 'node:assert/strict';
import test from 'node:test';
import { hashlessKey, pairFiles } from '../src/compare.js';
import { globToRegExp, matcher } from '../src/glob.js';

test('pairs identical names and hash-renamed files', () => {
  const r = pairFiles(
    ['dist/app.3f9a1c22.js', 'dist/a.css'],
    ['dist/app.b72e0011.js', 'dist/a.css'],
  );
  assert.deepEqual(r.pairs, [
    ['dist/a.css', 'dist/a.css'],
    ['dist/app.3f9a1c22.js', 'dist/app.b72e0011.js'],
  ]);
  assert.deepEqual(r.onlyA, []);
  assert.deepEqual(r.onlyB, []);
});

test('pairs vite-style base64 hashes', () => {
  assert.equal(hashlessKey('assets/index-BxK3_abc.js'), hashlessKey('assets/index-Q9Zk1_xy.js'));
});

test('does not pair ambiguous or unhashed names', () => {
  const r = pairFiles(['a.js', 'x.1234567.js', 'x.7654321.js'], ['b.js']);
  assert.deepEqual(r.pairs, []);
  assert.equal(r.onlyA.length, 3);
  assert.deepEqual(r.onlyB, ['b.js']);
});

test('glob matching', () => {
  assert.ok(globToRegExp('*.map').test('dist/app.js.map'));
  assert.ok(matcher(['node_modules'])('node_modules/x/y.js'));
  assert.ok(matcher(['dist/**'])('dist/a/b.js'));
  assert.ok(!matcher(['dist/*.js'])('dist/a/b.js'));
  assert.ok(!matcher(['src'])('lib/src2/x.js'));
});
