/**
 * Catalogue of non-determinism causes, with fix hints.
 * @typedef {'build-path'|'timestamp'|'random-id'|'ordering'|'archive-mtime'|'archive-order'|
 *   'archive-owner'|'archive-mode'|'gzip-header'|'hashed-filename'|'derived-checksum'|'missing-file'|'unexplained'} CauseId
 */

/** @type {Record<CauseId, { title: string, fix: string }>} */
export const CAUSES = {
  'build-path': {
    title: 'Absolute build path embedded',
    fix: 'Strip the build directory from outputs: Go `-trimpath`, Rust `--remap-path-prefix`, GCC/Clang `-ffile-prefix-map`, webpack/esbuild: avoid `__dirname` in bundled code, source maps: use relative `sources`.',
  },
  timestamp: {
    title: 'Build timestamp embedded',
    fix: 'Honour SOURCE_DATE_EPOCH instead of calling Date.now()/time.Now() at build time, or inject a fixed version string. Re-run with `--source-date-epoch` to test whether your toolchain already supports it.',
  },
  'random-id': {
    title: 'Random or unstable identifier',
    fix: 'Look for UUIDs, nonces or hashes derived from unstable input (e.g. a hash of a file that itself differs). Seed generators deterministically or derive IDs from content.',
  },
  ordering: {
    title: 'Unordered output',
    fix: 'Sort before writing: object keys, directory listings, set/map iteration, glob results. Most languages do not guarantee stable order across runs or filesystems.',
  },
  'archive-mtime': {
    title: 'File mtimes stored in archive',
    fix: 'Normalise mtimes when packaging: `tar --mtime=@$SOURCE_DATE_EPOCH --sort=name`, `zip -X` after `touch -d`, `npm pack` (>=9 already clamps tar mtimes to a constant).',
  },
  'archive-order': {
    title: 'Archive entry order differs',
    fix: 'Sort entries by name when creating the archive (`tar --sort=name`, or sort the file list before zipping).',
  },
  'archive-owner': {
    title: 'Owner/group stored in archive',
    fix: 'Use `--owner=0 --group=0 --numeric-owner` (tar) so the builder user does not leak into the artifact.',
  },
  'archive-mode': {
    title: 'File permissions differ in archive',
    fix: 'Set explicit modes; umask or checkout settings differ between environments.',
  },
  'gzip-header': {
    title: 'Timestamp in gzip header',
    fix: 'Use `gzip -n` (or `--no-name`) so the header carries no mtime/filename.',
  },
  'hashed-filename': {
    title: 'Content-hash in filename differs',
    fix: 'The hash is a symptom: fix the content that differs in the same build (see other causes) and the filename will stabilise.',
  },
  'derived-checksum': {
    title: 'Checksum derived from other differences',
    fix: 'A symptom, not a root cause (Mach-O code signature, ELF build-id, PE checksum). Fix the other causes reported for this file first and it will disappear.',
  },
  'missing-file': {
    title: 'File produced in only one build',
    fix: 'Output set depends on timing, randomness or environment. Check for temp files, conditional steps, or hashed names that do not pair up.',
  },
  unexplained: {
    title: 'Differs for an unclassified reason',
    fix: 'Inspect the diff offsets below; run again with `--keep` and compare the files with `diff` or `diffoscope`.',
  },
};
