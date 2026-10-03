import fs from 'node:fs';
import path from 'node:path';
import { compareOutputs } from './compare.js';
import { CAUSES } from './explain/causes.js';
import { matcher } from './glob.js';
import { runCommand } from './runner.js';
import { changedFiles, copyProject, makeWorkspaces, removeDir, snapshot } from './workspace.js';

/**
 * @typedef {import('./compare.js').FileResult} FileResult
 * @typedef {{
 *   command: string,
 *   cwd?: string,
 *   out?: string[],
 *   ignore?: string[],
 *   exclude?: string[],
 *   tz?: string,
 *   sourceDateEpoch?: boolean,
 *   keep?: boolean,
 *   timeoutMs?: number,
 *   showBuildOutput?: boolean,
 *   onProgress?: (msg: string) => void,
 * }} Options
 * @typedef {{ id: string, title: string, fix: string, files: number, count: number }} CauseTotal
 * @typedef {{
 *   command: string, projectDir: string, reproducible: boolean,
 *   runs: { a: RunInfo, b: RunInfo }, tzB: string, sourceDateEpoch: boolean,
 *   summary: { total: number, identical: number, different: number, onlyOne: number },
 *   causes: CauseTotal[], files: FileResult[], kept?: string,
 * }} Result
 * @typedef {{ ok: boolean, code: number | null, ms: number, root: string, logTail: string }} RunInfo
 */

const FIXED_EPOCH = '1700000000';
const MIN_GAP_MS = 1100;

export class BuildFailedError extends Error {
  /** @param {string} which @param {RunInfo} run */
  constructor(which, run) {
    super(`build ${which} exited with code ${run.code}`);
    this.which = which;
    this.run = run;
  }
}

/**
 * @param {Options} opts
 * @returns {Promise<Result>}
 */
export async function twinBuild(opts) {
  const projectDir = fs.realpathSync(path.resolve(opts.cwd ?? process.cwd()));
  const progress = opts.onProgress ?? (() => {});
  const tzB = opts.tz ?? 'America/Los_Angeles';
  const ignoreOut = matcher(['.git', 'node_modules', ...(opts.ignore ?? [])]);
  const excluded = matcher(opts.exclude ?? []);
  const outDirs = (opts.out ?? []).map((d) => d.replace(/^\.\//, '').replace(/\/+$/, ''));
  const inScope = (/** @type {string} */ p) =>
    outDirs.length === 0 || outDirs.some((d) => p === d || p.startsWith(`${d}/`));

  const ws = makeWorkspaces(projectDir);
  try {
    progress('copying project into two clean workspaces');
    copyProject(projectDir, ws.a, excluded);
    copyProject(projectDir, ws.b, excluded);
    const beforeA = snapshot(ws.a, ignoreOut);
    const beforeB = snapshot(ws.b, ignoreOut);

    const baseEnv = { ...process.env };
    if (opts.sourceDateEpoch) baseEnv.SOURCE_DATE_EPOCH = FIXED_EPOCH;
    const tzEnvB = tzB === 'same' ? {} : { TZ: tzB };

    progress('build A');
    const runA = await runCommand(opts.command, {
      cwd: ws.a,
      env: { ...baseEnv, TZ: baseEnv.TZ ?? 'UTC' },
      timeoutMs: opts.timeoutMs,
      inherit: opts.showBuildOutput,
    });
    const gap = MIN_GAP_MS - (Date.now() - runA.endedAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    progress('build B');
    const runB = await runCommand(opts.command, {
      cwd: ws.b,
      env: { ...baseEnv, TZ: baseEnv.TZ ?? 'UTC', ...tzEnvB },
      timeoutMs: opts.timeoutMs,
      inherit: opts.showBuildOutput,
    });

    /** @param {import('./runner.js').RunResult} r @param {string} root @returns {RunInfo} */
    const info = (r, root) => ({
      ok: r.code === 0,
      code: r.code,
      ms: r.endedAt - r.startedAt,
      root,
      logTail: r.log.split('\n').slice(-25).join('\n'),
    });
    const a = info(runA, ws.a);
    const b = info(runB, ws.b);
    if (!a.ok) throw new BuildFailedError('A', a);
    if (!b.ok) throw new BuildFailedError('B', b);

    progress('comparing outputs');
    const afterA = snapshot(ws.a, ignoreOut);
    const afterB = snapshot(ws.b, ignoreOut);
    const filesA = changedFiles(beforeA, afterA).filter(inScope);
    const filesB = changedFiles(beforeB, afterB).filter(inScope);

    const files = compareOutputs(ws.a, ws.b, filesA, filesB, {
      rootA: ws.a,
      rootB: ws.b,
      runA,
      runB,
    });

    // Keep samples readable: the random temp prefix is noise.
    const tidy = (/** @type {string} */ s) => s.split(ws.base).join('$TMP/twinbuild-XXXX');
    for (const f of files) {
      for (const c of f.causes) {
        for (const s of c.samples) {
          s.a = tidy(s.a);
          s.b = tidy(s.b);
        }
      }
    }

    /** @type {Map<string, CauseTotal>} */
    const totals = new Map();
    for (const f of files) {
      for (const c of f.causes) {
        const meta = CAUSES[c.id];
        const t = totals.get(c.id) ?? {
          id: c.id,
          title: meta.title,
          fix: meta.fix,
          files: 0,
          count: 0,
        };
        t.files += 1;
        t.count += c.count;
        totals.set(c.id, t);
      }
    }
    const different = files.filter((f) => f.status === 'different').length;
    const onlyOne = files.filter((f) => f.status === 'only-a' || f.status === 'only-b').length;
    /** @type {Result} */
    const result = {
      command: opts.command,
      projectDir,
      reproducible: different + onlyOne === 0,
      runs: { a, b },
      tzB,
      sourceDateEpoch: Boolean(opts.sourceDateEpoch),
      summary: {
        total: files.length,
        identical: files.length - different - onlyOne,
        different,
        onlyOne,
      },
      causes: [...totals.values()].sort((x, y) => y.files - x.files),
      files,
    };
    if (opts.keep) result.kept = ws.base;
    return result;
  } finally {
    if (!opts.keep) removeDir(ws.base);
  }
}
