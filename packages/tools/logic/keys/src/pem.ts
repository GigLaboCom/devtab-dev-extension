/**
 * PEM blocks in pasted text (RFC 7468 §2; the encapsulated headers of RFC 1421 that old OpenSSL writes on encrypted
 * keys — `Proc-Type`, `DEK-Info`) and the SSH2 public key blocks of RFC 4716. Text outside blocks is skipped. One pass
 * over the text, no regular expression over the whole of it (docs/tools/specs/keys.md §5.5, §12).
 */
export interface PemBlock {
  label: string;
  /** The Base64 lines between the headers and the END line, joined with `\n`. */
  body: string;
  /** RFC 1421 / RFC 4716 headers, names as written. */
  headers: Array<{ name: string; value: string }>;
  /** 1-based line of the BEGIN line. */
  line: number;
  /** Line (1-based) of the body's first line, for the place of a Base64 error. */
  bodyLine: number;
  /** `ssh2`: an RFC 4716 block (four dashes). */
  kind: 'pem' | 'ssh2';
  problem?: 'no-end' | 'end-mismatch';
  endLabel?: string;
}

/** At most this many blocks are read (a megabyte of BEGIN lines stays one pass). */
export const MAX_BLOCKS = 100;

const BEGIN = /^-----BEGIN ([A-Z0-9 ._-]{1,80})-----\s*$/;
const END = /^-----END ([A-Z0-9 ._-]{1,80})-----\s*$/;
const SSH2_BEGIN = /^---- BEGIN SSH2 PUBLIC KEY ----\s*$/;
const SSH2_END = /^---- END SSH2 PUBLIC KEY ----\s*$/;

/** PEM pasted out of JSON: the line breaks are the two characters `\n`. */
export const unescapeJsonPem = (text: string): string =>
  text.includes('-----BEGIN') && text.includes('\\n') && !/-----BEGIN[^\n]*-----\r?\n/.test(text)
    ? text.replace(/\\r\\n|\\n/g, '\n')
    : text;

export const findBlocks = (input: string): { blocks: PemBlock[]; more: boolean } => {
  const lines = unescapeJsonPem(input).split(/\r\n|\r|\n/);
  const blocks: PemBlock[] = [];
  let more = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    const pem = BEGIN.exec(raw);
    const ssh2 = !pem && SSH2_BEGIN.test(raw);
    if (!pem && !ssh2) continue;
    if (blocks.length === MAX_BLOCKS) {
      more = true;
      break;
    }
    const label = pem ? pem[1]! : 'SSH2 PUBLIC KEY';
    const block: PemBlock = { label, body: '', headers: [], line: i + 1, bodyLine: i + 2, kind: pem ? 'pem' : 'ssh2' };
    const body: string[] = [];
    let inHeaders = true;
    let continued: { name: string; value: string } | null = null;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j]!.trim();
      const end = pem ? END.exec(l) : SSH2_END.test(l) ? [l, label] : null;
      if (end) {
        if (end[1] !== label) {
          block.problem = 'end-mismatch';
          block.endLabel = end[1];
        }
        break;
      }
      if (pem ? BEGIN.test(l) : SSH2_BEGIN.test(l)) {
        j--;
        block.problem = 'no-end';
        break;
      }
      if (inHeaders) {
        if (continued) {
          // RFC 4716 §3.3: a header line ending in "\" continues on the next line.
          const tail = l.endsWith('\\');
          continued.value += tail ? l.slice(0, -1) : l;
          if (!tail) continued = null;
          continue;
        }
        const colon = l.indexOf(':');
        if (colon > 0 && /^[A-Za-z][A-Za-z0-9-]*$/.test(l.slice(0, colon))) {
          const value = l.slice(colon + 1).trim();
          const header = { name: l.slice(0, colon), value: value.endsWith('\\') ? value.slice(0, -1) : value };
          block.headers.push(header);
          if (value.endsWith('\\')) continued = header;
          block.bodyLine = j + 2;
          continue;
        }
        if (l === '' && block.headers.length > 0) {
          block.bodyLine = j + 2;
          continue;
        }
        inHeaders = false;
        block.bodyLine = j + 1;
      }
      body.push(lines[j]!);
    }
    if (j >= lines.length) block.problem = 'no-end';
    block.body = body.join('\n');
    blocks.push(block);
    i = j;
  }
  return { blocks, more };
};

/** RFC 4716 §3.3.2: the Comment header's value, without the quotes a writer may put around it. */
export const ssh2Comment = (block: PemBlock): string | undefined => {
  const h = block.headers.find(x => x.name.toLowerCase() === 'comment');
  if (!h) return undefined;
  const v = h.value;
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
};
