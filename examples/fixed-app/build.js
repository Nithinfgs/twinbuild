// The same build as ../leaky-app with every reproducibility bug fixed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTgz } from './tar.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);

// Honour SOURCE_DATE_EPOCH, with a fixed fallback instead of "now".
const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 1700000000);
const files = fs.readdirSync(src).sort();

const body = files
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(src, f), 'utf8'))
  .join('\n');
const buildId = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
const bundle = `/* fixed-app 1.0.0, built ${new Date(epoch * 1000).toISOString()} */
window.__BUILD_ID__ = "${buildId}";
${body}`;
const hash = crypto.createHash('sha1').update(bundle).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(dist, `app.${hash}.js`), bundle);

const manifest = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(src, f)).size]));
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

const entries = [
  ...files.map((f) => ({
    name: `src/${f}`,
    data: fs.readFileSync(path.join(src, f)),
    mtime: epoch,
  })),
  { name: 'manifest.json', data: fs.readFileSync(path.join(dist, 'manifest.json')), mtime: epoch },
];
fs.writeFileSync(path.join(dist, 'release.tgz'), makeTgz(entries));
console.log(`built ${fs.readdirSync(dist).length} files`);
