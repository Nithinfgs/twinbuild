# How twinbuild works

## Module map

| Path | Responsibility |
| --- | --- |
| `src/twinbuild.js` | Orchestration: workspaces, two runs, snapshotting, result assembly |
| `src/workspace.js` | Project copy, stat snapshots, "what did the build change" |
| `src/runner.js` | Spawns the build command with a bounded log tail and timeout |
| `src/compare.js` | Pairs output files (including hash-renamed ones) and compares bytes |
| `src/explain/index.js` | The cause detectors for files and archives |
| `src/explain/causes.js` | Cause catalogue: titles and fix advice |
| `src/archive.js` | Dependency-free tar/gzip and zip readers |
| `src/report/*` | Text, HTML renderers (JSON is the result object itself) |
| `src/cli.js` | Argument parsing and exit codes |

## Explaining a difference

Both files are read as latin1 strings (lossless for bytes, so the same code handles text and binaries). Detectors run in a fixed order, each one *normalising* its kind of noise out of both sides:

1. **Build path**: occurrences of workspace A's root in file A / workspace B's root in file B become `<ROOT>`.
2. **Timestamps**: ISO-8601, `YYYY-MM-DD HH:MM:SS`, HTTP dates, C `__DATE__`/`__TIME__`, and epoch seconds/millis that fall within two minutes of that build's run window.
3. **IDs**: UUIDs and hex runs of 12+ characters.
4. **Ordering**: equal after sorting lines or comma-separated items, or equal as JSON after sorting keys.

A cause is recorded only when the list of matches differs between A and B. If the files are equal after a step the analysis stops; otherwise later detectors continue on the normalised text. What remains is `unexplained`, or `derived-checksum` for binaries that already have known causes (Mach-O signatures, ELF build-ids and similar checksum fields change as a consequence).

Archives (`.tgz`, `.tar.gz`, `.tar`, `.zip`, `.jar`, `.whl`, `.nupkg`, `.vsix`, `.apk`) are parsed; gzip header, entry order, mtimes, owners and modes are compared, and each entry's content goes through the detectors above with the entry name in the location (`dist/release.tgz!manifest.json`).

## Adding a detector

1. Add an id and `{ title, fix }` to `src/explain/causes.js`.
2. Add detection in `src/explain/index.js` (look at the timestamp block for the pattern).
3. Add a unit test in `test/explain.test.js` with two small strings; no real build is needed.
