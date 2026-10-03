// A realistic build script with five classic reproducibility bugs.
// Run `npx twinbuild -- npm run build` here to see them found.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { makeTgz } from './tar.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);

const files = fs.readdirSync(src);

// Bug 1+2+3: build time, absolute path and a random build id baked into the bundle.
const body = files
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(src, f), 'utf8'))
  .join('\n');
const bundle = `/* leaky-app 1.0.0, built ${new Date().toISOString()} in ${root} */
window.__BUILD_ID__ = "${crypto.randomUUID()}";
${body}`;

// Bug 4: content hash in the filename (a symptom: it inherits the bundle's differences).
const hash = crypto.createHash('sha1').update(bundle).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(dist, `app.${hash}.js`), bundle);

// Bug 5: assets are measured concurrently and recorded in completion order.
/** @type {Record<string, number>} */
const manifest = {};
await Promise.all(
  files.map(async (f) => {
    await sleep(Math.random() * 40);
    manifest[f] = fs.statSync(path.join(src, f)).size;
  }),
);
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

// The release archive stores current mtimes and entries in manifest order.
const mtime = Math.floor(Date.now() / 1000);
const entries = [
  ...Object.keys(manifest).map((f) => ({
    name: `src/${f}`,
    data: fs.readFileSync(path.join(src, f)),
    mtime,
  })),
  { name: 'manifest.json', data: fs.readFileSync(path.join(dist, 'manifest.json')), mtime },
];
fs.writeFileSync(path.join(dist, 'release.tgz'), makeTgz(entries));
console.log(`built ${fs.readdirSync(dist).length} files`);
