import { spawn } from 'node:child_process';

/**
 * @typedef {{ code: number | null, signal: string | null, startedAt: number, endedAt: number,
 *   log: string, timedOut: boolean }} RunResult
 */

const MAX_LOG = 64 * 1024;

/**
 * Run a shell command, capturing a bounded tail of combined output.
 * @param {string} command
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, timeoutMs?: number, inherit?: boolean }} opts
 * @returns {Promise<RunResult>}
 */
export function runCommand(command, opts) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: opts.cwd,
      env: opts.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    let timedOut = false;
    /** @param {Buffer} d */
    const onData = (d) => {
      const s = d.toString('utf8');
      if (opts.inherit) process.stderr.write(s);
      log += s;
      if (log.length > MAX_LOG) log = log.slice(-MAX_LOG);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;
    child.on('error', (err) => {
      log += `\n${err.message}\n`;
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, startedAt, endedAt: Date.now(), log, timedOut });
    });
  });
}
