import { archiveKind, parseArchive } from '../archive.js';

/**
 * @typedef {import('./causes.js').CauseId} CauseId
 * @typedef {{ where?: string, a: string, b: string }} Sample
 * @typedef {{ id: CauseId, count: number, samples: Sample[] }} Cause
 * @typedef {{ rootA: string, rootB: string,
 *   runA: { startedAt: number, endedAt: number },
 *   runB: { startedAt: number, endedAt: number } }} ExplainContext
 */

const MAX_EXPLAIN_BYTES = 32 * 1024 * 1024;
const MAX_SAMPLES = 3;

const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?/g;
const ISO_SPACE = /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?/g;
const HTTP_DATE =
  /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),? (?:\w{3} \d{1,2}|\d{1,2} \w{3}) \d{4} \d\d:\d\d:\d\d/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ID = /\b[0-9a-f]{12,}\b/gi;

/**
 * @param {string} s
 * @param {RegExp} re
 * @returns {{ text: string, index: number }[]}
 */
function findAll(s, re) {
  const out = [];
  for (const m of s.matchAll(re)) out.push({ text: m[0], index: m.index ?? 0 });
  return out;
}

/**
 * @param {string} s
 * @param {number} index
 * @param {number} len
 */
function around(s, index, len) {
  const from = Math.max(0, index - 36);
  const to = Math.min(s.length, index + len + 36);
  const text = s
    .slice(from, to)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: sanitising binary for display
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\xff]/g, '·')
    .replace(/\n/g, '⏎')
    .trim();
  return (from > 0 ? '…' : '') + text + (to < s.length ? '…' : '');
}

/**
 * @param {string} s
 * @param {number} index
 */
function lineOf(s, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Replace matches with a placeholder and report whether the two sides disagreed on them.
 * @param {string} A
 * @param {string} B
 * @param {{ text: string, index: number }[]} ma
 * @param {{ text: string, index: number }[]} mb
 * @param {string} placeholder
 * @param {string} where
 * @returns {{ A: string, B: string, cause: { count: number, samples: Sample[] } | null }}
 */
function applyTokens(A, B, ma, mb, placeholder, where) {
  const same = ma.length === mb.length && ma.every((m, i) => m.text === mb[i].text);
  if (ma.length === 0 && mb.length === 0) return { A, B, cause: null };
  /** @type {Sample[]} */
  const samples = [];
  if (!same) {
    const n = Math.max(ma.length, mb.length);
    for (let i = 0; i < n && samples.length < MAX_SAMPLES; i++) {
      const x = ma[i];
      const y = mb[i];
      if (x?.text === y?.text) continue;
      samples.push({
        where: `${where} line ${lineOf(A, x?.index ?? 0)}`,
        a: x ? around(A, x.index, x.text.length) : '(absent)',
        b: y ? around(B, y.index, y.text.length) : '(absent)',
      });
    }
  }
  const rep = (/** @type {string} */ s, /** @type {{text:string,index:number}[]} */ m) => {
    let out = '';
    let last = 0;
    for (const t of m) {
      out += s.slice(last, t.index) + placeholder;
      last = t.index + t.text.length;
    }
    return out + s.slice(last);
  };
  return {
    A: rep(A, ma),
    B: rep(B, mb),
    cause: same ? null : { count: Math.max(ma.length, mb.length), samples },
  };
}

/**
 * @param {Buffer} bufA
 * @param {Buffer} bufB
 * @param {ExplainContext} ctx
 * @param {string} label used in sample locations
 * @returns {Cause[]}
 */
export function explainBytes(bufA, bufB, ctx, label = '') {
  /** @type {Cause[]} */
  const causes = [];
  /** @param {CauseId} id @param {{count:number,samples:Sample[]}} c */
  const push = (id, c) => causes.push({ id, count: c.count, samples: c.samples });

  if (bufA.length > MAX_EXPLAIN_BYTES || bufB.length > MAX_EXPLAIN_BYTES) {
    return [
      {
        id: 'unexplained',
        count: 1,
        samples: [{ a: `${bufA.length} bytes`, b: `${bufB.length} bytes (too large to analyse)` }],
      },
    ];
  }

  let A = bufA.toString('latin1');
  let B = bufB.toString('latin1');
  const where = label || 'file';

  // 1. build path
  {
    const ma = findAll(A, new RegExp(escapeRe(ctx.rootA), 'g'));
    const mb = findAll(B, new RegExp(escapeRe(ctx.rootB), 'g'));
    if (ma.length || mb.length) {
      const r = applyTokens(A, B, ma, mb, '<ROOT>', where);
      // Roots always differ textually, so any occurrence is a cause.
      const samples = r.cause?.samples ?? [];
      if (!samples.length) {
        samples.push({
          where: `${where} line ${lineOf(A, ma[0]?.index ?? 0)}`,
          a: ma[0] ? around(A, ma[0].index, ma[0].text.length) : '(absent)',
          b: mb[0] ? around(B, mb[0].index, mb[0].text.length) : '(absent)',
        });
      }
      push('build-path', { count: Math.max(ma.length, mb.length), samples });
      A = r.A;
      B = r.B;
    }
  }
  if (A === B) return causes;

  // 2. timestamps
  {
    const find = (/** @type {string} */ s, /** @type {{startedAt:number,endedAt:number}} */ run) =>
      [
        ...findAll(s, ISO),
        ...findAll(s, ISO_SPACE),
        ...findAll(s, HTTP_DATE),
        ...findAll(s, /\b1\d{12}\b/g).filter((m) => inWindow(Number(m.text), run, 1)),
        ...findAll(s, /\b1\d{9}\b/g).filter((m) => inWindow(Number(m.text), run, 1000)),
      ].sort((x, y) => x.index - y.index);
    const r = applyTokens(A, B, find(A, ctx.runA), find(B, ctx.runB), '<TIME>', where);
    if (r.cause) push('timestamp', r.cause);
    A = r.A;
    B = r.B;
  }
  if (A === B) return causes;

  // 3. random / unstable ids
  {
    const find = (/** @type {string} */ s) =>
      [...findAll(s, UUID), ...findAll(s, HEX_ID)].sort((x, y) => x.index - y.index);
    const r = applyTokens(A, B, find(A), find(B), '<ID>', where);
    if (r.cause) push('random-id', r.cause);
    A = r.A;
    B = r.B;
  }
  if (A === B) return causes;

  // 4. ordering
  if (isReordering(A, B)) {
    causes.push({
      id: 'ordering',
      count: 1,
      samples: [{ where, a: firstDiff(A, B).a, b: firstDiff(A, B).b }],
    });
    return causes;
  }

  const d = firstDiff(A, B);
  causes.push({ id: 'unexplained', count: 1, samples: [{ where, a: d.a, b: d.b }] });
  return causes;
}

/**
 * @param {number} n
 * @param {{startedAt:number,endedAt:number}} run
 * @param {number} unitMs ms per unit of n
 */
function inWindow(n, run, unitMs) {
  const ms = n * unitMs;
  return ms >= run.startedAt - 120_000 && ms <= run.endedAt + 120_000;
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} A
 * @param {string} B
 */
function firstDiff(A, B) {
  let i = 0;
  const n = Math.min(A.length, B.length);
  while (i < n && A[i] === B[i]) i++;
  return { index: i, a: around(A, i, 1), b: around(B, i, 1) };
}

/**
 * True if A and B contain the same lines/items in a different order, or the same JSON
 * with different key order.
 * @param {string} A
 * @param {string} B
 */
function isReordering(A, B) {
  for (const sep of ['\n', ',']) {
    const x = A.split(sep);
    const y = B.split(sep);
    if (x.length > 1 && x.length === y.length) {
      const sx = [...x].sort();
      const sy = [...y].sort();
      if (sx.every((v, i) => v === sy[i])) return true;
    }
  }
  try {
    return canonical(JSON.parse(A)) === canonical(JSON.parse(B));
  } catch {
    return false;
  }
}

/** @param {unknown} v @returns {string} */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(/** @type {any} */ (v)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Explain a pair of files, descending into archives.
 * @param {string} relPath
 * @param {Buffer} bufA
 * @param {Buffer} bufB
 * @param {ExplainContext} ctx
 * @returns {Cause[]}
 */
export function explainFile(relPath, bufA, bufB, ctx) {
  const kind = archiveKind(relPath);
  if (kind) {
    try {
      return explainArchive(relPath, bufA, bufB, kind, ctx);
    } catch {
      // fall through to byte-level analysis
    }
  }
  return explainBytes(bufA, bufB, ctx, relPath);
}

/**
 * @param {string} relPath
 * @param {Buffer} bufA
 * @param {Buffer} bufB
 * @param {'tar'|'zip'} kind
 * @param {ExplainContext} ctx
 * @returns {Cause[]}
 */
function explainArchive(relPath, bufA, bufB, kind, ctx) {
  const A = parseArchive(bufA, kind);
  const B = parseArchive(bufB, kind);
  /** @type {Map<CauseId, Cause>} */
  const acc = new Map();
  /** @param {CauseId} id @param {number} n @param {Sample} s */
  const add = (id, n, s) => {
    const c = acc.get(id) ?? { id, count: 0, samples: [] };
    c.count += n;
    if (c.samples.length < MAX_SAMPLES) c.samples.push(s);
    acc.set(id, c);
  };

  if (A.gzipMtime !== B.gzipMtime || A.gzipOs !== B.gzipOs) {
    add('gzip-header', 1, {
      where: relPath,
      a: `mtime=${A.gzipMtime} os=${A.gzipOs}`,
      b: `mtime=${B.gzipMtime} os=${B.gzipOs}`,
    });
  }
  const namesA = A.entries.map((e) => e.name);
  const namesB = B.entries.map((e) => e.name);
  const setB = new Set(namesB);
  const setA = new Set(namesA);
  for (const n of namesA)
    if (!setB.has(n)) add('missing-file', 1, { where: relPath, a: n, b: '(absent)' });
  for (const n of namesB)
    if (!setA.has(n)) add('missing-file', 1, { where: relPath, a: '(absent)', b: n });
  const commonA = namesA.filter((n) => setB.has(n));
  const commonB = namesB.filter((n) => setA.has(n));
  if (commonA.some((n, i) => n !== commonB[i])) {
    const i = commonA.findIndex((n, k) => n !== commonB[k]);
    add('archive-order', 1, {
      where: relPath,
      a: `#${i}: ${commonA[i]}`,
      b: `#${i}: ${commonB[i]}`,
    });
  }
  const byB = new Map(B.entries.map((e) => [e.name, e]));
  for (const ea of A.entries) {
    const eb = byB.get(ea.name);
    if (!eb) continue;
    const loc = `${relPath}!${ea.name}`;
    if (ea.mtime !== eb.mtime) {
      add('archive-mtime', 1, {
        where: loc,
        a: new Date(ea.mtime * 1000).toISOString(),
        b: new Date(eb.mtime * 1000).toISOString(),
      });
    }
    if (ea.mode !== eb.mode) {
      add('archive-mode', 1, { where: loc, a: ea.mode.toString(8), b: eb.mode.toString(8) });
    }
    if (ea.uid !== eb.uid || ea.gid !== eb.gid || ea.owner !== eb.owner) {
      add('archive-owner', 1, {
        where: loc,
        a: `${ea.uid}:${ea.gid} ${ea.owner}`,
        b: `${eb.uid}:${eb.gid} ${eb.owner}`,
      });
    }
    if (!ea.data.equals(eb.data)) {
      for (const c of explainBytes(ea.data, eb.data, ctx, loc)) {
        const cur = acc.get(c.id) ?? { id: c.id, count: 0, samples: [] };
        cur.count += c.count;
        for (const s of c.samples) if (cur.samples.length < MAX_SAMPLES) cur.samples.push(s);
        acc.set(c.id, cur);
      }
    }
  }
  if (acc.size === 0) {
    add('unexplained', 1, {
      where: relPath,
      a: 'archive entries and metadata are identical',
      b: 'compressed bytes differ: compressor, level or version',
    });
  }
  return [...acc.values()];
}
