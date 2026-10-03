import zlib from 'node:zlib';

/**
 * @typedef {{ name: string, mtime: number, mode: number, uid: number, gid: number,
 *   owner: string, data: Buffer }} ArchiveEntry
 * @typedef {{ kind: 'tar' | 'zip', entries: ArchiveEntry[], gzipMtime?: number,
 *   gzipOs?: number }} Archive
 */

/** @param {string} name */
export function archiveKind(name) {
  const n = name.toLowerCase();
  if (/\.(tgz|tar\.gz|tar)$/.test(n)) return 'tar';
  if (/\.(zip|jar|war|whl|vsix|nupkg|apk)$/.test(n)) return 'zip';
  return null;
}

/**
 * @param {Buffer} buf
 * @param {number} off
 * @param {number} len
 */
function cstr(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const z = slice.indexOf(0);
  return slice.subarray(0, z === -1 ? slice.length : z).toString('utf8');
}

/**
 * @param {Buffer} buf
 * @param {number} off
 * @param {number} len
 */
function octal(buf, off, len) {
  const s = cstr(buf, off, len).trim();
  return s ? Number.parseInt(s, 8) || 0 : 0;
}

/**
 * @param {Buffer} input
 * @returns {Archive}
 */
export function parseTar(input) {
  let buf = input;
  /** @type {Partial<Archive>} */
  const meta = {};
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    meta.gzipMtime = buf.readUInt32LE(4);
    meta.gzipOs = buf[9];
    buf = zlib.gunzipSync(buf);
  }
  /** @type {ArchiveEntry[]} */
  const entries = [];
  let off = 0;
  let paxPath = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let name = cstr(h, 0, 100);
    const prefix = cstr(h, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    if (paxPath) {
      name = paxPath;
      paxPath = null;
    }
    entries.push({
      name,
      mtime: octal(h, 136, 12),
      mode: octal(h, 100, 8),
      uid: octal(h, 108, 8),
      gid: octal(h, 116, 8),
      owner: `${cstr(h, 265, 32)}:${cstr(h, 297, 32)}`,
      data: type === '5' ? Buffer.alloc(0) : Buffer.from(body),
    });
  }
  return { kind: 'tar', entries, ...meta };
}

/**
 * @param {number} date DOS date
 * @param {number} time DOS time
 */
function dosToEpoch(date, time) {
  const y = ((date >> 9) & 0x7f) + 1980;
  const mo = ((date >> 5) & 0x0f) - 1;
  const d = date & 0x1f;
  const h = (time >> 11) & 0x1f;
  const mi = (time >> 5) & 0x3f;
  const s = (time & 0x1f) * 2;
  return Math.floor(Date.UTC(y, mo, d, h, mi, s) / 1000);
}

/**
 * @param {Buffer} buf
 * @returns {Archive}
 */
export function parseZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  /** @type {ArchiveEntry[]} */
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(
      lho + 30 + lNameLen + lExtraLen,
      lho + 30 + lNameLen + lExtraLen + csize,
    );
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    entries.push({
      name,
      mtime: dosToEpoch(date, time),
      mode: (extAttr >>> 16) & 0xffff,
      uid: 0,
      gid: 0,
      owner: '',
      data,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { kind: 'zip', entries };
}

/**
 * @param {Buffer} buf
 * @param {'tar' | 'zip'} kind
 * @returns {Archive}
 */
export function parseArchive(buf, kind) {
  return kind === 'tar' ? parseTar(buf) : parseZip(buf);
}
