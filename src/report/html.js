import { CAUSES } from '../explain/causes.js';

/** @typedef {import('../twinbuild.js').Result} Result */

/** @param {string} s */
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Self-contained, dependency-free HTML report.
 * @param {Result} r
 */
export function renderHtml(r) {
  const verdict = r.reproducible ? 'Reproducible' : 'Not reproducible';
  const rows = r.files
    .filter((f) => f.status !== 'identical')
    .map((f) => {
      const causes = f.causes
        .map((c) => {
          const s = c.samples[0];
          return `<li><strong>${esc(CAUSES[c.id].title)}</strong>${
            s ? `<pre><span>A</span> ${esc(s.a)}\n<span>B</span> ${esc(s.b)}</pre>` : ''
          }</li>`;
        })
        .join('');
      return `<section><h3>${esc(f.pathB ? `${f.path} ~ ${f.pathB}` : f.path)}</h3><ul>${causes}</ul></section>`;
    })
    .join('\n');
  const totals = r.causes
    .map((t) => `<tr><td>${esc(t.title)}</td><td>${t.files}</td><td>${esc(t.fix)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>twinbuild report</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mut:#666;--bad:#c62828;--ok:#2e7d32;--card:#f5f5f5}
@media(prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#999;--bad:#ef5350;--ok:#66bb6a;--card:#1c1c1c}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:960px;margin:2rem auto;padding:0 1rem}
h1{margin:0}.v{font-size:1.4rem;color:${r.reproducible ? 'var(--ok)' : 'var(--bad)'}}
code,pre{font-family:ui-monospace,monospace;font-size:13px}pre{background:var(--card);padding:.6rem;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-all}
pre span{color:var(--mut)}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.4rem;border-bottom:1px solid var(--card);vertical-align:top}
section{background:var(--card);border-radius:8px;padding:.1rem 1rem;margin:1rem 0}.m{color:var(--mut)}
</style></head><body>
<h1>twinbuild</h1><p class="m"><code>${esc(r.command)}</code></p>
<p class="v">${verdict}: ${r.summary.different + r.summary.onlyOne} of ${r.summary.total} output files differ</p>
${r.causes.length ? `<table><tr><th>Cause</th><th>Files</th><th>Fix</th></tr>${totals}</table>` : ''}
${rows}
</body></html>
`;
}
