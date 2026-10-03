import zlib from 'node:zlib';

/**
 * Tiny ustar writer so the examples do not depend on the system `tar`.
 * @param {{ name: string, data: Buffer, mtime: number }[]} entries
 */
export function makeTgz(entries) {
  const blocks = [];
  for (const e of entries) {
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${e.data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write(`${e.mtime.toString(8).padStart(11, '0')}\0`, 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}
