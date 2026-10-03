import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { renderHtml } from './report/html.js';
import { renderText } from './report/text.js';
import { BuildFailedError, twinBuild } from './twinbuild.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `twinbuild ${pkg.version}
Build your project twice in clean copies and explain why the outputs differ.

Usage
  twinbuild [options] -- <build command>
  twinbuild -- npm run build
  twinbuild --out dist -- make release

Options
  --out <dir>             Only compare files under <dir> (repeatable). Default: every
                          file the build creates or modifies.
  --ignore <glob>         Ignore matching paths when finding outputs (repeatable).
  --exclude <glob>        Do not copy matching paths into the workspaces (repeatable).
  --tz <zone>             Time zone for build B (default America/Los_Angeles, 'same' to disable).
  --source-date-epoch     Set SOURCE_DATE_EPOCH to the same value in both builds.
  --timeout <seconds>     Kill a build after this long (default 900).
  --json                  Print the full result as JSON.
  --html <file>           Also write a standalone HTML report.
  --show-build-output     Stream build output to stderr.
  --keep                  Keep the temporary workspaces for inspection.
  --no-color              Disable colours.
  -v, --version           Print version.
  -h, --help              Print this help.

Exit codes: 0 reproducible, 1 outputs differ, 2 error (e.g. the build failed).
`;

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const sep = argv.indexOf('--');
  const optArgs = sep === -1 ? argv : argv.slice(0, sep);
  const cmdArgs = sep === -1 ? [] : argv.slice(sep + 1);

  /** @type {ReturnType<typeof parseArgs>} */
  let parsed;
  try {
    parsed = parseArgs({
      args: optArgs,
      allowPositionals: true,
      options: {
        out: { type: 'string', multiple: true },
        ignore: { type: 'string', multiple: true },
        exclude: { type: 'string', multiple: true },
        tz: { type: 'string' },
        'source-date-epoch': { type: 'boolean' },
        timeout: { type: 'string' },
        json: { type: 'boolean' },
        html: { type: 'string' },
        'show-build-output': { type: 'boolean' },
        keep: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    process.stderr.write(`twinbuild: ${/** @type {Error} */ (err).message}\n\n${HELP}`);
    return 2;
  }
  const v = parsed.values;
  if (v.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (v.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const command = (cmdArgs.length ? cmdArgs : parsed.positionals)
    .map((a) =>
      /[\s"'$`\\&|;<>()*?]/.test(a) && cmdArgs.length ? `'${a.replace(/'/g, `'\\''`)}'` : a,
    )
    .join(' ')
    .trim();
  if (!command) {
    process.stderr.write('twinbuild: no build command given. Try: twinbuild -- npm run build\n');
    return 2;
  }
  const timeout = v.timeout ? Number(v.timeout) : 900;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    process.stderr.write('twinbuild: --timeout must be a positive number of seconds\n');
    return 2;
  }
  const color = !v['no-color'] && !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
  const quiet = Boolean(v.json);

  try {
    const result = await twinBuild({
      command,
      out: /** @type {string[] | undefined} */ (v.out),
      ignore: /** @type {string[] | undefined} */ (v.ignore),
      exclude: /** @type {string[] | undefined} */ (v.exclude),
      tz: /** @type {string | undefined} */ (v.tz),
      sourceDateEpoch: Boolean(v['source-date-epoch']),
      keep: Boolean(v.keep),
      timeoutMs: timeout * 1000,
      showBuildOutput: Boolean(v['show-build-output']),
      onProgress: quiet ? undefined : (m) => process.stderr.write(`twinbuild: ${m}…\n`),
    });
    if (v.html) fs.writeFileSync(/** @type {string} */ (v.html), renderHtml(result));
    if (v.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(renderText(result, { color }));
    if (result.kept) process.stderr.write(`twinbuild: workspaces kept in ${result.kept}\n`);
    return result.reproducible ? 0 : 1;
  } catch (err) {
    if (err instanceof BuildFailedError) {
      process.stderr.write(
        `twinbuild: build ${err.which} failed (exit ${err.run.code}). Last output:\n\n${err.run.logTail}\n\nThe build must succeed in a fresh copy of the project. Does it rely on untracked files, env vars or network access?\n`,
      );
      return 2;
    }
    process.stderr.write(`twinbuild: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }
}
