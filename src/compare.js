import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { explainFile } from './explain/index.js';

/**
 * @typedef {import('./explain/index.js').Cause} Cause
 * @typedef {import('./explain/index.js').ExplainContext} ExplainContext
 * @typedef {{ path: string, pathB?: string, status: 'identical' | 'different' | 'only-a' | 'only-b',
 *   size: number, causes: Cause[] }} FileResult
 */

/** @param {Buffer} b */
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * Key used to pair files whose names embed a content hash (app.3f9a1c.js ~ app.b72e00.js).
 * @param {string} p
 */
export function hashlessKey(p) {
  return p
    .replace(/[0-9a-f]{6,}/gi, '#')
    .replace(/(?<=[-.])[A-Za-z0-9_]{6,12}(?=\.[A-Za-z0-9]+$)/, '#');
}

/**
 * @param {string[]} filesA relative paths changed by build A
 * @param {string[]} filesB relative paths changed by build B
 * @returns {{ pairs: [string, string][], onlyA: string[], onlyB: string[] }}
 */
export function pairFiles(filesA, filesB) {
  const setB = new Set(filesB);
  const setA = new Set(filesA);
  /** @type {[string, string][]} */
  const pairs = [];
  for (const p of filesA) if (setB.has(p)) pairs.push([p, p]);
  const restA = filesA.filter((p) => !setB.has(p));
  const restB = filesB.filter((p) => !setA.has(p));
  /** @type {Map<string, string[]>} */
  const ka = new Map();
  /** @type {Map<string, string[]>} */
  const kb = new Map();
  for (const p of restA) ka.set(hashlessKey(p), [...(ka.get(hashlessKey(p)) ?? []), p]);
  for (const p of restB) kb.set(hashlessKey(p), [...(kb.get(hashlessKey(p)) ?? []), p]);
  const usedA = new Set();
  const usedB = new Set();
  for (const [k, la] of ka) {
    const lb = kb.get(k);
    if (lb && la.length === 1 && lb.length === 1 && k.includes('#')) {
      pairs.push([la[0], lb[0]]);
      usedA.add(la[0]);
      usedB.add(lb[0]);
    }
  }
  return {
    pairs,
    onlyA: restA.filter((p) => !usedA.has(p)),
    onlyB: restB.filter((p) => !usedB.has(p)),
  };
}

/**
 * @param {string} rootA
 * @param {string} rootB
 * @param {string[]} filesA
 * @param {string[]} filesB
 * @param {ExplainContext} ctx
 * @returns {FileResult[]}
 */
export function compareOutputs(rootA, rootB, filesA, filesB, ctx) {
  const { pairs, onlyA, onlyB } = pairFiles(filesA, filesB);
  /** @type {FileResult[]} */
  const out = [];
  for (const [pa, pb] of pairs) {
    const bufA = readSafe(path.join(rootA, pa));
    const bufB = readSafe(path.join(rootB, pb));
    const size = bufA.length;
    if (bufA.equals(bufB) && sha(bufA) === sha(bufB)) {
      out.push({
        path: pa,
        ...(pa !== pb ? { pathB: pb } : {}),
        status: 'identical',
        size,
        causes: [],
      });
      continue;
    }
    /** @type {Cause[]} */
    const causes = [];
    if (pa !== pb) {
      causes.push({ id: 'hashed-filename', count: 1, samples: [{ a: pa, b: pb }] });
    }
    causes.push(...explainFile(pa, bufA, bufB, ctx));
    out.push({ path: pa, ...(pa !== pb ? { pathB: pb } : {}), status: 'different', size, causes });
  }
  for (const p of onlyA) {
    out.push({
      path: p,
      status: 'only-a',
      size: readSafe(path.join(rootA, p)).length,
      causes: [{ id: 'missing-file', count: 1, samples: [{ a: p, b: '(absent)' }] }],
    });
  }
  for (const p of onlyB) {
    out.push({
      path: p,
      status: 'only-b',
      size: readSafe(path.join(rootB, p)).length,
      causes: [{ id: 'missing-file', count: 1, samples: [{ a: '(absent)', b: p }] }],
    });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

/** @param {string} p */
function readSafe(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return Buffer.alloc(0);
  }
}
