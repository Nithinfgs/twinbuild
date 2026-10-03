# Changelog

## 0.1.0

First release.

- Build any command twice in two fresh project copies (different path, clock, time zone)
- Attribute differences to build paths, timestamps (ISO, epoch, C `__DATE__`/`__TIME__`), random IDs, ordering, hashed filenames, derived checksums
- Archive analysis for tar/tgz and zip-family formats (mtime, order, owner, mode, gzip header, per-entry content)
- Text, `--brief`, `--json` and standalone `--html` reports; CI-friendly exit codes
- `--out`, `--ignore`, `--exclude`, `--tz`, `--source-date-epoch`, `--keep`
- Example projects: `leaky-app`, `fixed-app`, `c-timestamp`
