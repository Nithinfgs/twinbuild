// Renders real twinbuild output into docs/assets/*.svg (no screenshots, no fakes).
// Usage: node scripts/make-demo.js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'twinbuild.js');

const COLORS = /** @type {Record<string, string>} */ ({
  31: '#ff7b72',
  32: '#3fb950',
  33: '#e3b341',
  36: '#79c0ff',
  2: '#8b949e',
});

const ESC = String.fromCharCode(27);
const SGR_SPLIT = new RegExp(`(${ESC}\\[[0-9;]*m)`);
const SGR_ONE = new RegExp(`^${ESC}\\[([0-9;]*)m$`);
const SGR_ALL = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {string} line
 * @returns {string} tspans
 */
function ansiToTspans(line) {
  let fill = '';
  let bold = false;
  let out = '';
  for (const part of line.split(SGR_SPLIT)) {
    const m = SGR_ONE.exec(part);
    if (m) {
      const code = m[1];
      if (code === '0') {
        fill = '';
        bold = false;
      } else if (code === '1') bold = true;
      else if (COLORS[code]) fill = COLORS[code];
    } else if (part) {
      const attrs = `${fill ? ` fill="${fill}"` : ''}${bold ? ' font-weight="700"' : ''}`;
      out += `<tspan${attrs}>${esc(part)}</tspan>`;
    }
  }
  return out;
}

/**
 * @param {string[]} lines raw lines, may contain ANSI
 * @param {string} title
 */
function svg(lines, title) {
  const lh = 20;
  const cw = 9.1;
  const cols = Math.max(...lines.map((l) => l.replace(SGR_ALL, '').length), 60);
  const w = Math.ceil(cols * cw + 56);
  const h = lines.length * lh + 64;
  const body = lines
    .map(
      (l, i) =>
        `<text x="24" y="${52 + i * lh}" xml:space="preserve">${ansiToTspans(l) || ' '}</text>`,
    )
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect width="${w}" height="${h}" rx="10" fill="#0d1117"/>
<circle cx="22" cy="18" r="6" fill="#ff5f56"/><circle cx="42" cy="18" r="6" fill="#ffbd2e"/><circle cx="62" cy="18" r="6" fill="#27c93f"/>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="14" fill="#c9d1d9">
${body}
</g>
</svg>
`;
}

const prompt = (/** @type {string} */ s) => `\x1b[32m$\x1b[0m \x1b[1m${s}\x1b[0m`;

/**
 * @param {string} example
 * @param {string[]} args
 */
function runIn(example, args) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: path.join(root, 'examples', example),
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: '' },
  });
  return r.stdout.replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
}

const hero = [
  prompt('cd examples/leaky-app'),
  prompt('npx twinbuild --brief -- npm run build'),
  ...runIn('leaky-app', ['--brief', '--', 'npm', 'run', 'build']).slice(0),
  '',
  prompt('cd ../fixed-app   # same project after fixing those causes'),
  prompt('npx twinbuild --brief -- npm run build'),
  ...runIn('fixed-app', ['--brief', '--', 'npm', 'run', 'build']),
];

const detail = [
  prompt('npx twinbuild -- npm run build'),
  ...runIn('leaky-app', ['--max-files', '1', '--', 'npm', 'run', 'build'])
    .join('\n')
    .split('\n  How to fix')[0]
    .split('\n')
    .slice(2, 30),
];

const out = path.join(root, 'docs', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'demo.svg'),
  svg(hero, 'twinbuild finds why two identical builds differ'),
);
fs.writeFileSync(
  path.join(out, 'detail.svg'),
  svg(detail, 'twinbuild shows the evidence for each cause'),
);
console.log('wrote docs/assets/demo.svg and docs/assets/detail.svg');
