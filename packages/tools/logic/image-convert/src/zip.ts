/**
 * A store-only `.zip` writer and CRC-32 (docs/tools/specs/image-convert.md §5.10; PKWARE APPNOTE 6.3.x §4.3): PNG,
 * JPEG and WebP are compressed already, so the files are stored (method 0) and the archive is only headers around them.
 * The result is a list of parts — headers and the files' own bytes, never copied into one array — for `new Blob(parts)`.
 * No ZIP64: an archive over 4 GiB or 65,535 files is refused (this tool makes at most 20 files of 100 megapixels).
 * Names are UTF-8, flagged (bit 11) when they are not plain ASCII; times are the local time in MS-DOS form.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO-HDLC, the one ZIP and PNG use); `previous` continues a CRC over several pieces. */
export const crc32 = (bytes: Uint8Array, previous = 0): number => {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

const LIMIT = 0xffffffff;

/** MS-DOS date and time of a moment in local time (2-second steps, years 1980–2107). */
export const dosDateTime = (moment: Date): { date: number; time: number } => {
  const year = Math.min(2107, Math.max(1980, moment.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate(),
    time: (moment.getHours() << 11) | (moment.getMinutes() << 5) | (moment.getSeconds() >> 1),
  };
};

export const zipParts = (files: readonly ZipFile[], modified: Date): Uint8Array[] => {
  if (files.length > 0xffff) throw new Error('A .zip without ZIP64 holds at most 65,535 files.');
  const { date, time } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const utf8 = /[^\x20-\x7e]/.test(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;
    if (size > LIMIT || offset > LIMIT) throw new Error('The files are too large for a .zip without ZIP64.');
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true); // version needed: 2.0
    l.setUint16(6, utf8 ? 0x0800 : 0, true); // flags: bit 11, UTF-8 name
    l.setUint16(8, 0, true); // method: stored
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true); // extra field length
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); // version made by: 2.0, MS-DOS
    c.setUint16(6, 20, true);
    c.setUint16(8, utf8 ? 0x0800 : 0, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    // extra, comment, disk number, internal and external attributes: 0
    c.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, file.data);
    central.push(entry);
    offset += local.length + size;
  }
  const centralSize = central.reduce((sum, e) => sum + e.length, 0);
  if (offset > LIMIT || offset + centralSize > LIMIT)
    throw new Error('The files are too large for a .zip without ZIP64.');
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true); // entries on this disk
  e.setUint16(10, files.length, true); // entries in all
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return [...parts, ...central, end];
};
