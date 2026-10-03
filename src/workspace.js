import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {{ size: number, mtimeMs: number }} StatInfo
 */

const ALWAYS_SKIP_COPY = new Set(['.git']);

/**
 * Create the two scratch roots. The project directory name is kept identical so that
 * tools which embed the directory name stay stable; only the parent path differs.
 * @param {string} projectDir
 * @returns {{ base: string, a: string, b: string }}
 */
export function makeWorkspaces(projectDir) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'twinbuild-'));
  const name = path.basename(projectDir);
  // Different parent lengths on purpose: catches code that depends on path length.
  const a = path.join(base, 'a', name);
  const b = path.join(base, 'build-b-longer-prefix', name);
  return { base, a, b };
}

/**
 * Copy the project, keeping timestamps and relative symlinks.
 * @param {string} src
 * @param {string} dest
 * @param {(rel: string) => boolean} isExcluded
 */
export function copyProject(src, dest, isExcluded) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    mode: fs.constants.COPYFILE_FICLONE,
    filter: (s) => {
      const rel = path.relative(src, s).split(path.sep).join('/');
      if (rel === '') return true;
      if (ALWAYS_SKIP_COPY.has(rel.split('/')[0])) return false;
      return !isExcluded(rel);
    },
  });
}

/**
 * Stat every regular file under root (symlinks are recorded by target string).
 * @param {string} root
 * @param {(rel: string) => boolean} isIgnored directories matching are not entered
 * @returns {Map<string, StatInfo & { link?: string }>}
 */
export function snapshot(root, isIgnored) {
  /** @type {Map<string, StatInfo & { link?: string }>} */
  const out = new Map();
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (isIgnored(r)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, r);
      else if (ent.isSymbolicLink()) {
        const st = fs.lstatSync(full);
        out.set(r, { size: st.size, mtimeMs: st.mtimeMs, link: fs.readlinkSync(full) });
      } else if (ent.isFile()) {
        const st = fs.statSync(full);
        out.set(r, { size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  walk(root, '');
  return out;
}

/**
 * Files that were created or rewritten by the build.
 * @param {Map<string, StatInfo>} before
 * @param {Map<string, StatInfo>} after
 * @returns {string[]} sorted relative paths
 */
export function changedFiles(before, after) {
  const res = [];
  for (const [p, st] of after) {
    const prev = before.get(p);
    if (!prev || prev.size !== st.size || prev.mtimeMs !== st.mtimeMs) res.push(p);
  }
  return res.sort();
}

/** @param {string} dir */
export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
