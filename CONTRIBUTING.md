# Contributing to twinbuild

Thanks for helping. The project is small on purpose: zero runtime dependencies, one job.

## Setup

```bash
git clone https://github.com/Nithinfgs/twinbuild && cd twinbuild
npm install
npm run check     # biome lint + tsc --checkJs + node:test
npm run format    # auto-format
npm run demo      # regenerate docs/assets/*.svg from real output
```

Node 20 or newer. The code is plain ESM JavaScript with JSDoc types, checked by `tsc` in strict mode.

## Good first contributions

- **A new explainer** for a toolchain you know (e.g. Rust `--remap-path-prefix` leftovers, Python `.pyc` timestamps, Java class-file ids). Add the cause to `src/explain/causes.js`, the detection to `src/explain/index.js`, and a unit test with two tiny strings. See [docs/how-it-works.md](docs/how-it-works.md).
- **A real-world false positive/negative**: open an issue with the smallest build that shows it. Fixtures are welcome.
- **An example project** under `examples/` that reproduces a classic leak.

## Pull requests

- Keep PRs focused; add or update tests (`test/`) for behaviour changes.
- `npm run check` must pass.
- Do not add runtime dependencies without discussing it in an issue first.
- Do not make performance or accuracy claims in docs without a reproducible measurement.
- Use conventional-style commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Reporting bugs

Please include the command, OS, Node version, and the `--json` output if you can share it. For security issues see [SECURITY.md](SECURITY.md).
