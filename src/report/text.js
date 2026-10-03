import { CAUSES } from '../explain/causes.js';

/** @typedef {import('../twinbuild.js').Result} Result */

/** @param {boolean} on */
function palette(on) {
  /** @param {string} code */
  const w = (code) => (/** @type {string} */ s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    bold: w('1'),
    dim: w('2'),
    red: w('31'),
    green: w('32'),
    yellow: w('33'),
    cyan: w('36'),
  };
}

/** @param {number} ms */
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/**
 * @param {string} s
 * @param {number} n
 */
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * @param {Result} r
 * @param {{ color?: boolean, maxFiles?: number, verbose?: boolean }} [o]
 */
export function renderText(r, o = {}) {
  const c = palette(o.color ?? false);
  const maxFiles = o.maxFiles ?? 12;
  const L = [];
  L.push('');
  L.push(`${c.bold('twinbuild')}  ${c.dim(r.command)}`);
  L.push('');
  L.push(`  ${c.dim('build A')}  ${c.green('✓')} ${secs(r.runs.a.ms)}`);
  const tzNote = r.tzB === 'same' ? 'same TZ' : `TZ=${r.tzB}`;
  L.push(
    `  ${c.dim('build B')}  ${c.green('✓')} ${secs(r.runs.b.ms)}  ${c.dim(`different path, +1s clock, ${tzNote}`)}`,
  );
  L.push('');

  const s = r.summary;
  if (s.total === 0) {
    L.push(c.yellow('  No output files were created or modified by the build.'));
    L.push(
      c.dim('  Use --out <dir> if your build writes outside the project, or check the command.'),
    );
    L.push('');
    return L.join('\n');
  }
  if (r.reproducible) {
    L.push(
      `  ${c.green(c.bold('✓ REPRODUCIBLE'))}  all ${s.total} output files are byte-identical`,
    );
    if (r.sourceDateEpoch) L.push(c.dim('    (with SOURCE_DATE_EPOCH fixed)'));
    L.push('');
    return L.join('\n');
  }
  const bad = s.different + s.onlyOne;
  L.push(
    `  ${c.red(c.bold('✗ NOT REPRODUCIBLE'))}  ${c.bold(String(bad))} of ${s.total} output files differ between two identical builds`,
  );
  L.push('');
  L.push(`  ${c.dim('CAUSE'.padEnd(44))}${c.dim('FILES')}`);
  for (const t of r.causes) {
    L.push(`  ${t.title.padEnd(44)}${String(t.files).padStart(3)}`);
  }
  L.push('');

  const badFiles = r.files.filter((f) => f.status !== 'identical');
  for (const f of badFiles.slice(0, maxFiles)) {
    const ids = [...new Set(f.causes.map((x) => x.id))].join(', ');
    L.push(`  ${c.bold(f.pathB ? `${f.path} ~ ${f.pathB}` : f.path)}  ${c.dim(ids)}`);
    for (const cause of f.causes) {
      const sample = cause.samples[0];
      if (!sample) continue;
      const label = CAUSES[cause.id].title;
      const where = sample.where ? c.dim(` (${sample.where})`) : '';
      L.push(`    ${c.yellow('•')} ${label}${where}`);
      L.push(`        ${c.dim('A')} ${c.cyan(trunc(sample.a, 96))}`);
      L.push(`        ${c.dim('B')} ${c.cyan(trunc(sample.b, 96))}`);
    }
  }
  if (badFiles.length > maxFiles) {
    L.push(
      c.dim(`  … and ${badFiles.length - maxFiles} more (use --json or --html for the full list)`),
    );
  }
  L.push('');
  L.push(c.bold('  How to fix'));
  for (const t of r.causes) {
    L.push(`  ${c.yellow('•')} ${c.bold(t.title)}`);
    L.push(`    ${t.fix}`);
  }
  L.push('');
  L.push(
    c.dim(
      '  Why it matters: content-addressed caches (Turborepo, Nx, Bazel, Docker layers) treat every\n  differing file as a cache miss, and nobody can verify your artifact by rebuilding it.',
    ),
  );
  L.push('');
  return L.join('\n');
}
