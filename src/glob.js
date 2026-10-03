/**
 * Minimal glob support: `*` (no slash), `**` (any depth), `?`.
 * Patterns without a slash match against any path segment sequence's basename.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  const anchoredToBase = !pattern.includes('/');
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(anchoredToBase ? `(?:^|/)${re}(?:/.*)?$` : `^${re}(?:/.*)?$`);
}

/**
 * @param {string[]} patterns
 * @returns {(relPath: string) => boolean}
 */
export function matcher(patterns) {
  const res = patterns.map(globToRegExp);
  return (p) => res.some((r) => r.test(p));
}
