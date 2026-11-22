import {
  ALSO_ZIP_NOTE,
  COPY_MAX_CHARS,
  DEFAULT_ENCODE_OPTIONS,
  FILE_TYPES,
  NO_COMMA,
  ADDRESS,
  PEM_BEGIN,
  SECRET_TYPES,
  cleanFileName,
  createInputDecoder,
  decodeInput,
  decodeTextBlob,
  describe as describeFile,
  detectBase64File,
  encodeBlob,
  encodeBytes,
  encodedLength,
  extensionOf,
  fileTooLarge,
  formatSize,
  isMimeType,
  pemNoEnd,
  previewOutput,
  recogniseBlob,
  recogniseBytes,
  sampleOf,
  shownNote,
  suggestName,
  textFileName,
  textFileTooLarge,
  withArticle,
} from './index';
import { CERTIFICATE_DER_B64, REQUEST_DER_B64, SAMPLES, binary, bytes, fromB64, utf8, zip } from './testing/samples';
import { parseBase64 } from '@workspace/tools-shared/base64';
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { EncodeOptions } from './index';

const b64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');
const opts = (o: Partial<EncodeOptions>): EncodeOptions => ({ ...DEFAULT_ENCODE_OPTIONS, ...o });
const recognise = (data: Uint8Array) => recogniseBytes(sampleOf(data));
const decoded = (text: string) => {
  const r = decodeInput(text);
  if (!r.ok) throw new Error(`not decoded: ${r.error.message}`);
  return r;
};
const failed = (text: string) => {
  const r = decodeInput(text);
  if (r.ok) throw new Error('decoded');
  return r.error;
};
const a60 = utf8('a'.repeat(60));

describe('§10: encoding (python3 3.14.7 base64, FreeBSD base64 of macOS 26.7.3)', () => {
  it('an empty file is an empty output', () => {
    expect(encodeBytes(new Uint8Array(0), opts({}))).toBe('');
    expect(encodeBytes(new Uint8Array(0), opts({ form: 'dataUri' }))).toBe('data:application/octet-stream;base64,');
  });

  it('both alphabets, with and without padding', () => {
    expect(encodeBytes(bytes([0]), opts({}))).toBe('AA==');
    expect(encodeBytes(bytes([0]), opts({ alphabet: 'url', padding: false }))).toBe('AA');
    expect(encodeBytes(bytes([0xff, 0xfe, 0xfd]), opts({}))).toBe('//79');
    expect(encodeBytes(bytes([0xff, 0xfe, 0xfd]), opts({ alphabet: 'url', padding: false }))).toBe('__79');
    expect(encodeBytes(bytes([0xfb, 0xff]), opts({}))).toBe('+/8=');
    expect(encodeBytes(bytes([0xfb, 0xff]), opts({ alphabet: 'url', padding: false }))).toBe('-_8');
  });

  it('wraps at 64 and 76 with \\n, no newline at the end', () => {
    const at64 = encodeBytes(a60, opts({ lineLength: 64 }));
    expect(at64.split('\n').map(l => l.length)).toEqual([64, 16]);
    expect(at64.endsWith('\nYWFhYWFhYWFhYWFh')).toBe(true);
    const at76 = encodeBytes(a60, opts({ lineLength: 76 }));
    expect(at76.split('\n').map(l => l.length)).toEqual([76, 4]);
    expect(at76.endsWith('\nYWFh')).toBe(true);
  });

  it('a data URI is standard, padded and unwrapped whatever the Base64 options (§5.1 п. 3)', () => {
    const o = opts({ form: 'dataUri', type: 'application/pdf', alphabet: 'url', padding: false, lineLength: 64 });
    expect(encodeBytes(utf8('%PDF-1.7\n'), o)).toBe('data:application/pdf;base64,JVBERi0xLjcK');
    expect(encodeBytes(bytes([0xfb, 0xff]), o)).toBe('data:application/pdf;base64,+/8=');
    expect(encodeBytes(a60, o)).not.toContain('\n');
  });

  it('the data URI type of text, of unknown bytes and of a PDF (§10)', () => {
    const text = describeFile(recognise(utf8('hello world')), { fileName: 'a.txt' });
    expect(text.dataUriType).toBe('text/plain;charset=utf-8');
    expect(encodeBytes(utf8('hello world'), opts({ form: 'dataUri', type: text.dataUriType }))).toBe(
      'data:text/plain;charset=utf-8;base64,aGVsbG8gd29ybGQ=',
    );
    const unknown = describeFile(recognise(bytes([0, 1, 2])), { fileName: 'x.dat' });
    expect(unknown.dataUriType).toBe('application/octet-stream');
    expect(encodeBytes(bytes([0, 1, 2]), opts({ form: 'dataUri', type: unknown.dataUriType }))).toBe(
      'data:application/octet-stream;base64,AAEC',
    );
    const pdf = describeFile(recognise(SAMPLES[0]![1]), { fileName: 'r.pdf' });
    expect(pdf.dataUriType).toBe('application/pdf');
  });

  it('encodedLength is the output’s length, without encoding (§5.1 п. 6)', () => {
    for (const size of [0, 1, 2, 3, 4, 47, 48, 49, 57, 58, 911, 912, 1000])
      for (const o of [
        opts({}),
        opts({ padding: false }),
        opts({ lineLength: 64 }),
        opts({ lineLength: 76, padding: false }),
        opts({ form: 'dataUri', type: 'font/woff2' }),
      ])
        expect(encodedLength(size, o)).toBe(encodeBytes(binary(size), o).length);
    expect(encodedLength(2 ** 31, opts({}))).toBe(2_863_311_532);
  });

  it('the preview is the start of the whole output', () => {
    const file = binary(100_000);
    for (const o of [opts({}), opts({ lineLength: 76 }), opts({ form: 'dataUri', type: 'x/y' })]) {
      const whole = encodeBytes(file, o);
      expect(previewOutput(file.subarray(0, 49_152), file.length, o, 65_536)).toBe(whole.slice(0, 65_536));
    }
    expect(previewOutput(bytes([0]), 1, opts({}), 65_536)).toBe('AA==');
  });

  it('isMimeType: type/subtype and parameters (§5.1 п. 4)', () => {
    for (const ok of ['application/pdf', 'text/plain;charset=utf-8', 'text/plain; charset="utf-8"', 'a/b;x=y;z=w'])
      expect(isMimeType(ok)).toBe(true);
    for (const bad of [
      '',
      'pdf',
      'application/',
      'a/b,c',
      'a/b;base64',
      'a b/c',
      'a/b;x="a,b"',
      `a/${'b'.repeat(260)}`,
    ])
      expect(isMimeType(bad)).toBe(false);
  });
});

describe('§5.1 п. 2: encoding in pieces', () => {
  it('pieces of 912 · k bytes give exactly the whole output, at every boundary and option', async () => {
    const options = [
      opts({}),
      opts({ padding: false }),
      opts({ alphabet: 'url', padding: false }),
      opts({ lineLength: 64 }),
      opts({ lineLength: 76 }),
      opts({ lineLength: 64, alphabet: 'url', padding: false }),
      opts({ form: 'dataUri', type: 'application/zip' }),
    ];
    const sizes = [0, 1, 2, 3, 4, 911, 912, 913, 1215, 1216, 1217, 1823, 1824, 1825, 2735, 2736, 2737, 5000];
    for (const chunkBytes of [912, 1824, 2736])
      for (const size of sizes) {
        const file = binary(size, size + 1);
        for (const o of options) {
          const parts: string[] = [];
          await encodeBlob(new Blob([file]), o, t => parts.push(t), { chunkBytes });
          expect(parts.join(''), `${size} bytes in pieces of ${chunkBytes}`).toBe(encodeBytes(file, o));
        }
      }
  });

  it('rounds a piece size down to a multiple of 912, never below 912', async () => {
    const file = binary(3000);
    const parts: string[] = [];
    await encodeBlob(new Blob([file]), opts({ lineLength: 76 }), t => parts.push(t), { chunkBytes: 1000 });
    expect(parts.length).toBe(4);
    expect(parts.join('')).toBe(encodeBytes(file, opts({ lineLength: 76 })));
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodeBlob(new Blob([binary(5000)]), opts({}), () => undefined, { signal: controller.signal }),
    ).rejects.toThrow('aborted');
  });
});

describe('§5.3, §6, §10: decoding', () => {
  it('bare Base64 of either alphabet, padded or not, wrapped or not', () => {
    expect([...decoded('//79').bytes]).toEqual([0xff, 0xfe, 0xfd]);
    expect([...decoded('__79').bytes]).toEqual([0xff, 0xfe, 0xfd]);
    expect([...decoded('-_8').bytes]).toEqual([0xfb, 0xff]);
    expect(decoded(encodeBytes(a60, opts({ lineLength: 76 })) + '\r\n').bytes).toEqual(a60);
    expect(decoded('  AA==\n').header).toEqual({
      shape: 'base64',
      base64: true,
      declaredMime: null,
      name: null,
      pemLabel: null,
    });
  });

  it('empty input, white space, an empty body: no bytes and no error', () => {
    for (const text of ['', '  \n\t ', 'data:application/pdf;base64,', 'data:,'])
      expect(decoded(text).bytes.length).toBe(0);
    expect(decoded('   ').header).toBeNull();
  });

  it('errors are the shared reader’s, with their place in the input as typed', () => {
    for (const text of [
      'Zm9v!',
      'Zm9vY',
      'Zg=',
      'Zg===',
      '====',
      'Zg==Zm9v',
      'Zm9v\n😀',
      'JVBERi0x!jcK',
      'Zm9v\u{A0}YmFy',
    ]) {
      const shared = parseBase64(text);
      expect(shared.ok).toBe(false);
      expect(failed(text)).toEqual(shared.ok ? null : shared.error);
    }
    expect(failed('JVBERi0x!jcK')).toEqual({ message: 'invalid character "!"', offset: 8, line: 1, column: 9 });
    expect(failed('Zm9vY')).toMatchObject({ message: 'one character too many at the end', column: 5 });
    expect(failed('Zg==Zm9v')).toMatchObject({ message: 'misplaced padding "="', column: 3 });
    expect(failed('Zm9v\n😀')).toMatchObject({ message: 'invalid character "😀"', line: 2, column: 1 });
  });

  it('data: URIs in every spelling (Fetch §6.2, as base64-image)', () => {
    const pdf = bytes('%PDF-1.7\n');
    expect(decoded('data:application/pdf;base64,JVBERi0xLjcK').bytes).toEqual(pdf);
    expect(decoded('DATA:application/pdf; BASE64,JVBERi0xLjcK').bytes).toEqual(pdf);
    expect(decoded('data:application/pdf;base64,JVBERi0x\nLjcK').bytes).toEqual(pdf);
    expect(decoded('data:application/pdf;base64,JVBERi0xLjcK').header).toEqual({
      shape: 'data-uri',
      base64: true,
      declaredMime: 'application/pdf',
      name: null,
      pemLabel: null,
    });
    expect(decoded('data:application/x\n-y;base64,AAEC').header?.declaredMime).toBe('application/x-y');
    expect([...decoded('data:;base64,AAEC').bytes]).toEqual([0, 1, 2]);
    expect(decoded('data:;base64,AAEC').header?.declaredMime).toBeNull();
    expect(new TextDecoder().decode(decoded('data:text/plain,hello%20world').bytes)).toBe('hello world');
    expect(new TextDecoder().decode(decoded('data:text/plain,a\tb\nc').bytes)).toBe('a\tb\nc');
    expect(new TextDecoder().decode(decoded('data:,%E2%82%AC and €').bytes)).toBe('€ and €');
    // An escape in a Base64 body: `+` written `%2B`.
    expect([...decoded('data:x/y;base64,%2B%2F8%3D').bytes]).toEqual([0xfb, 0xff]);
  });

  it('a data URI’s errors: no comma; Base64 with its place; no place after an escape', () => {
    expect(failed('data:application/pdf;base64')).toEqual({ message: NO_COMMA });
    expect(failed('data:application/pdf;base64,JVBERi0x!jcK')).toEqual({
      message: 'invalid character "!"',
      offset: 36,
      line: 1,
      column: 37,
    });
    expect(failed('data:x/y;base64,AA!%2B')).toMatchObject({ offset: 18 });
    expect(failed('data:x/y;base64,%2BAA!')).toEqual({ message: 'invalid character "!"' });
  });

  it('name and filename parameters, percent-decoded (§5.3 п. 2)', () => {
    expect(decoded('data:application/pdf;name=report.pdf;base64,JVBERi0xLjcK').header?.name).toBe('report.pdf');
    expect(decoded('data:application/pdf;FileName="a%20b.pdf";base64,JVBERi0xLjcK').header?.name).toBe('a b.pdf');
    expect(decoded('data:x/y;name=..%2F..%2Fevil%0A.pdf;base64,AA==').header?.name).toBe('../../evil\n.pdf');
  });

  it('a PEM block: the Base64 between BEGIN and END (RFC 7468 §2)', () => {
    const der = fromB64(CERTIFICATE_DER_B64);
    const pem = `-----BEGIN CERTIFICATE-----\n${CERTIFICATE_DER_B64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
    const r = decoded(pem);
    expect(r.bytes).toEqual(der);
    expect(r.header).toMatchObject({ shape: 'pem', pemLabel: 'CERTIFICATE' });
    expect(decoded(`notes\n\n${pem}`.slice(7)).bytes).toEqual(der);
    expect(decoded(`${pem}trailing explanatory text`).bytes).toEqual(der);
    expect(decoded(pem.replace(/\n/g, ' ')).bytes).toEqual(der);
    expect(failed('-----BEGIN CERTIFICATE-----\nMIIB')).toEqual({ message: pemNoEnd('CERTIFICATE') });
    expect(failed('-----BEGIN CERTIFICATE-----\nAAAA\n-----END KEY-----')).toEqual({
      message: pemNoEnd('CERTIFICATE'),
    });
    expect(failed('-----BEGIN CERTIFICATE\nAAAA')).toEqual({ message: PEM_BEGIN });
    expect(failed('-----BEGIN CERTIFICATE-----\nAA!A\n-----END CERTIFICATE-----')).toEqual({
      message: 'invalid character "!"',
      offset: 30,
      line: 2,
      column: 3,
    });
  });

  it('an address is refused in words', () => {
    for (const a of [
      'https://example.com/a.pdf',
      'http://x',
      '//cdn.example/a',
      'file:///etc/hosts',
      'blob:chrome-extension://x/y',
    ])
      expect(failed(a)).toEqual({ message: ADDRESS });
  });

  it('a decoder takes its input in pieces of any size', () => {
    const text = `data:application/pdf;base64,${b64(binary(5000))}`;
    for (const size of [1, 2, 3, 7, 64, 1000]) {
      const decoder = createInputDecoder({ chunkChars: 64 });
      const parts: Uint8Array[] = [];
      for (let at = 0; at < text.length; at += size) {
        const step = decoder.push(text.slice(at, at + size));
        if (!step.ok) throw new Error(step.error.message);
        parts.push(...step.bytes);
      }
      const last = decoder.end();
      if (!last.ok) throw new Error(last.error.message);
      parts.push(...last.bytes);
      expect(Buffer.concat(parts)).toEqual(Buffer.from(binary(5000)));
    }
  });

  it('a text Blob is read in slices, a character cut by a slice waits for the next', async () => {
    const data = binary(10_000);
    const text = `  ${b64(data).replace(/.{76}/g, '$&\n')}\n`;
    const out: Uint8Array[] = [];
    const r = await decodeTextBlob(new Blob([text]), b => out.push(b), { readBytes: 999, chunkChars: 400 });
    expect(r).toMatchObject({ ok: true, size: 10_000 });
    expect(Buffer.concat(out)).toEqual(Buffer.from(data));
    // A two-byte character split by the slices: the error names it whole and places it.
    const bad = await decodeTextBlob(new Blob(['AAAA\nAAé']), () => undefined, { readBytes: 8 });
    expect(bad).toEqual({ ok: false, error: { message: 'invalid character "é"', offset: 7, line: 2, column: 3 } });
  });
});

describe('§5.2: recognising the type — a table test of every signature', () => {
  it.each(SAMPLES.map(([id, data], i) => [`${i} ${id}`, id, data] as const))('%s', (_, id, data) => {
    expect(recognise(data).type.id).toBe(id);
  });

  it('the same through a Blob (head, tail, directory, whole)', async () => {
    for (const [id, data] of SAMPLES) expect((await recogniseBlob(new Blob([data]))).type.id).toBe(id);
  });

  it('a ZIP family file whose directory is past the head is still narrowed', async () => {
    const big = zip([
      ['[Content_Types].xml', '<Types/>'],
      ['padding.bin', 'x'.repeat(200_000)],
      ['word/document.xml', '<w:document/>'],
    ]);
    expect((await recogniseBlob(new Blob([big]))).type.id).toBe('docx');
  });

  it('keys made by node:crypto: PKCS #8, encrypted PKCS #8, SPKI, PKCS #1 and SEC1', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const der = (v: Buffer) => Uint8Array.from(v);
    expect(recognise(der(ec.privateKey.export({ type: 'pkcs8', format: 'der' }))).type.id).toBe('pkcs8');
    expect(
      recognise(der(ec.privateKey.export({ type: 'pkcs8', format: 'der', cipher: 'aes-256-cbc', passphrase: 'x' })))
        .type.id,
    ).toBe('pkcs8-encrypted');
    expect(recognise(der(ec.publicKey.export({ type: 'spki', format: 'der' }))).type.id).toBe('spki');
    expect(recognise(der(ec.privateKey.export({ type: 'sec1', format: 'der' }))).type.id).toBe('ec-private');
    expect(recognise(der(rsa.privateKey.export({ type: 'pkcs1', format: 'der' }))).type.id).toBe('rsa-private');
    expect(recognise(der(rsa.publicKey.export({ type: 'pkcs1', format: 'der' }))).type.id).toBe('rsa-public');
    const ed = generateKeyPairSync('ed25519');
    expect(recognise(der(ed.privateKey.export({ type: 'pkcs8', format: 'der' }))).type.id).toBe('pkcs8');
    expect(recognise(der(ed.publicKey.export({ type: 'spki', format: 'der' }))).type.id).toBe('spki');
  });

  it('private keys are the secret types (§11)', () => {
    expect([...SECRET_TYPES].sort()).toEqual(
      [
        'ec-private',
        'openssh-private',
        'pem-private',
        'pgp-private',
        'pkcs12',
        'pkcs8',
        'pkcs8-encrypted',
        'rsa-private',
      ].sort(),
    );
    expect(FILE_TYPES.x509.secret).toBe(false);
  });

  it('text that starts with a signature’s letters is text (§5.2 п. 3)', () => {
    for (const [text, like] of [
      ['GIF89a is a format', 'gif'],
      ['OTTO von Bismarck was', null],
      ['true story, really', null],
      ['BMW', null],
      ['wOFF the record', 'woff'],
      ['RIFFabcdWEBPVP8 text', 'webp'],
      ['fLaC is a codec', 'flac'],
      ['%PDF-1.7 is a version', 'pdf'],
    ] as const) {
      const r = recognise(utf8(text));
      expect(r.type.id, text).toBe('text');
      expect(r.startsLike, text).toBe(like);
    }
  });

  it('an all-text PDF is a PDF when it ends with %%EOF; %PDF-1.7 alone is text', () => {
    expect(recognise(utf8('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')).type.id).toBe('pdf');
    expect(recognise(utf8('%PDF-1.7\n')).type.id).toBe('text');
  });

  it('a polyglot: GIF and JavaScript at once is a GIF; a PDF with a ZIP appended is a PDF, and says so', () => {
    const gifJs = bytes('GIF89a/*', [0, 0, 0x80, 0, 0], '*/=0;alert(1);', [0x3b]);
    const r = recognise(gifJs);
    expect(r.type.id).toBe('gif');
    expect(r.alsoZip).toBe(false);
    const pdfZip = bytes(SAMPLES[0]![1], zip([['a.txt', 'hidden']]));
    const p = recognise(pdfZip);
    expect(p.type.id).toBe('pdf');
    expect(p.alsoZip).toBe(true);
    expect(describeFile(p).notes).toContain(ALSO_ZIP_NOTE);
    const jpegZip = bytes([0xff, 0xd8, 0xff, 0xe0], binary(100), zip([['a.txt', 'x']]));
    expect(recognise(jpegZip)).toMatchObject({ type: { id: 'jpeg' }, alsoZip: true });
  });

  it('an empty file is empty, without notes', () => {
    const r = describeFile(recognise(new Uint8Array(0)), { fileName: 'a.png' });
    expect(r.type.id).toBe('empty');
    expect(r.notes).toEqual([]);
  });

  it('JSON is checked whole by the shared scanner, up to 4 MiB', () => {
    expect(recognise(utf8('[1, 2,]')).type.id).toBe('text');
    expect(recognise(utf8(`[${'1,'.repeat(10)}1]`)).type.id).toBe('json');
  });
});

describe('§5.2: a file’s extension and a declared type', () => {
  const pdf = SAMPLES[0]![1];

  it('a lying extension: the bytes win and a note says so', () => {
    const d = describeFile(recognise(pdf), { fileName: 'photo.png' });
    expect(d.type.id).toBe('pdf');
    expect(d.notes).toEqual(['The name says .png, but the bytes are a PDF document.']);
    expect(describeFile(recognise(pdf), { fileName: 'report.PDF' }).notes).toEqual([]);
    expect(describeFile(recognise(pdf), { fileName: 'notes.weird' }).notes).toEqual([]);
  });

  it('text: a text extension names it; a binary one is a note', () => {
    expect(describeFile(recognise(utf8('a,b\n1,2\n')), { fileName: 'data.csv' })).toMatchObject({
      type: { name: 'CSV text', mime: 'text/csv' },
      dataUriType: 'text/csv;charset=utf-8',
      notes: [],
    });
    expect(describeFile(recognise(utf8('hello')), { fileName: 'x.png' }).notes).toEqual([
      'The name says .png, but the bytes are text.',
    ]);
    expect(describeFile(recognise(utf8('{"a":')), { fileName: 'a.json' }).type.id).toBe('json');
  });

  it('unknown bytes: a binary extension without a signature names them; one with a signature is a note', () => {
    expect(describeFile(recognise(binary(64)), { fileName: 'song.mp3' }).type).toMatchObject({ mime: 'audio/mpeg' });
    expect(describeFile(recognise(binary(64)), { fileName: 'setup.exe' }).type.name).toBe('Windows executable');
    expect(describeFile(recognise(binary(64)), { fileName: 'a.pdf' })).toMatchObject({
      type: { id: 'unknown' },
      notes: ['The name says .pdf, but the bytes are not a PDF document.'],
    });
    expect(describeFile(recognise(binary(64)), { fileName: 'a.zzz' }).type.mime).toBe('application/octet-stream');
  });

  it('a declared type: a warning when the bytes disagree, none for octet-stream or an alias', () => {
    expect(describeFile(recognise(pdf), { declaredMime: 'image/png' }).notes).toEqual([
      'Declared image/png, but the bytes are a PDF document.',
    ]);
    expect(describeFile(recognise(pdf), { declaredMime: 'application/octet-stream' }).notes).toEqual([]);
    expect(describeFile(recognise(pdf), { declaredMime: 'application/x-pdf' }).notes).toEqual([]);
    expect(describeFile(recognise(SAMPLES[13]![1]), { declaredMime: 'application/x-gzip' }).notes).toEqual([]);
    expect(describeFile(recognise(utf8('{"a":1}')), { declaredMime: 'text/plain' }).notes).toEqual([]);
    expect(describeFile(recognise(utf8('a,b')), { declaredMime: 'text/csv' }).type.mime).toBe('text/csv');
    expect(describeFile(recognise(binary(64)), { declaredMime: 'application/pdf' }).notes).toEqual([
      'Declared application/pdf, but the bytes are not a PDF document.',
    ]);
  });

  it('articles as names are read aloud', () => {
    expect(withArticle('PDF document')).toBe('a PDF document');
    expect(withArticle('HTML document')).toBe('an HTML document');
    expect(withArticle('EPUB book')).toBe('an EPUB book');
    expect(withArticle('MP3 audio')).toBe('an MP3 audio');
    expect(withArticle('SVG image')).toBe('an SVG image');
    expect(withArticle('OpenDocument text')).toBe('an OpenDocument text');
    expect(withArticle('DER certificate')).toBe('a DER certificate');
    expect(withArticle('Word document (DOCX)')).toBe('a Word document (DOCX)');
  });
});

describe('§5.4: the file name', () => {
  it('cleans what could steer a save or hide in a name', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('..\\..\\Windows\\win.ini')).toBe('win.ini');
    expect(cleanFileName('../../evil\n.pdf')).toBe('evil.pdf');
    expect(cleanFileName('a\u0000b\u001Fc\u007F\u0085.txt')).toBe('abc.txt');
    expect(cleanFileName('invoice\u{202E}fdp.exe')).toBe('invoicefdp.exe');
    expect(cleanFileName('a<b>c:d"e|f?g*.txt')).toBe('a_b_c_d_e_f_g_.txt');
    expect(cleanFileName('  .hidden.  ')).toBe('hidden');
    expect(cleanFileName('CON')).toBe('_CON');
    expect(cleanFileName('lpt1.txt')).toBe('_lpt1.txt');
    expect(cleanFileName('')).toBe('file');
    expect(cleanFileName('/')).toBe('file');
    expect(cleanFileName('...')).toBe('file');
    const long = cleanFileName(`${'x'.repeat(300)}.pdf`);
    expect(long.length).toBe(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('suggests the extension of the bytes (§5.4)', () => {
    expect(suggestName(null, FILE_TYPES.pdf)).toBe('file.pdf');
    expect(suggestName('invoice.txt', FILE_TYPES.pdf)).toBe('invoice.pdf');
    expect(suggestName('report.pdf', FILE_TYPES.pdf)).toBe('report.pdf');
    expect(suggestName('photo.JPEG', FILE_TYPES.jpeg)).toBe('photo.JPEG');
    expect(suggestName('../../evil\n.pdf', FILE_TYPES.pdf)).toBe('evil.pdf');
    expect(suggestName(null, FILE_TYPES.unknown)).toBe('file.bin');
    expect(suggestName(null, FILE_TYPES.text)).toBe('file.txt');
    expect(suggestName('notes.md', FILE_TYPES.text)).toBe('notes.md');
    expect(suggestName('certificate', FILE_TYPES.x509)).toBe('certificate.cer');
    expect(suggestName('.pdf', FILE_TYPES.pdf)).toBe('pdf.pdf');
    expect(textFileName('disk.img')).toBe('disk.img.txt');
    expect(textFileName(null)).toBe('file.txt');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('a.tar.GZ')).toBe('gz');
  });
});

describe('§6, §10: sizes and messages', () => {
  it('formatSize', () => {
    expect(formatSize(0)).toBe('0 bytes');
    expect(formatSize(1)).toBe('1 byte');
    expect(formatSize(1023)).toBe('1,023 bytes');
    expect(formatSize(1024)).toBe('1,024 bytes (1.0 KiB)');
    expect(formatSize(1_269_328)).toBe('1,269,328 bytes (1.2 MiB)');
    expect(formatSize(1_048_575)).toBe('1,048,575 bytes (1.0 MiB)');
    expect(formatSize(2 ** 31)).toBe('2,147,483,648 bytes (2.0 GiB)');
  });

  it('the refusals and the notes', () => {
    expect(fileTooLarge(2 ** 31 + 1)).toBe(
      'The file is 2,147,483,649 bytes (2.0 GiB). This tool works with files up to 2 GiB.',
    );
    expect(textFileTooLarge(4 * 2 ** 30)).toBe(
      'The text file is 4,294,967,296 bytes (4.0 GiB). This tool reads Base64 text up to 3 GiB.',
    );
    expect(shownNote(2_147_483_648, false)).toBe(
      'Showing the first 65,536 of 2,147,483,648 characters. Too large to copy: Save saves all.',
    );
    expect(shownNote(2_000_000, true)).toBe('Showing the first 65,536 of 2,000,000 characters. Copy copies all.');
    expect(COPY_MAX_CHARS).toBe(16_777_216);
  });
});

describe('§7: detectBase64File', () => {
  const der = (b: Buffer) => b.toString('base64');
  it.each([
    'data:application/pdf;base64,JVBERi0xLjcK',
    'DATA:font/woff2;base64,d09GMg==',
    'data:text/plain,hi',
    'data:;base64,AAEC',
    'JVBERi0xLjcKJeLjz9MKMSAwIG9iago=',
    'UEsDBBQAAAAIAA==AAAA'.replace('==AAAA', 'AAAA'),
    'H4sIAAAAAAAAA+3B',
    'AGFzbQEAAAABBQFg',
    'd09GMgABAAAAAA==',
    CERTIFICATE_DER_B64,
    REQUEST_DER_B64,
    CERTIFICATE_DER_B64.replace(/.{64}/g, '$&\n'),
    b64(SAMPLES.find(s => s[0] === 'tiff')![1]),
    b64(SAMPLES.find(s => s[0] === 'ssh-public')![1]),
  ])('yes: %s', text => expect(detectBase64File(text)).toBe(true));

  it.each([
    'data:image/png;base64,iVBORw0KGgo',
    'DATA:IMAGE/SVG+XML,%3Csvg',
    'SGVsbG8sIFdvcmxkIQ==',
    'iVBORw0KGgoAAAANSUhEUg==',
    '/9j/4AAQSkZJRgABAQAAAQABAAD',
    'JVBERi0x',
    'data:application/pdf;base64',
    'data:application/pdf;base64,',
    'data:not a type;base64,AAAA',
    'hello world',
    'https://example.com/a.pdf',
    `-----BEGIN CERTIFICATE-----\n${CERTIFICATE_DER_B64}\n-----END CERTIFICATE-----`,
    'JVBERi0xLjcKJeLjz9MKMSAwIG9iago=!',
    'JVBE=Ri0xLjcKJeLjz9MKMSAwIG9iago=',
    'JVBERi0xLjcKJcOkw7zDtsOfCg==',
    b64(utf8('GIF89a is a format and more text')),
    b64(SAMPLES.find(s => s[0] === 'der')![1]),
    '550e8400-e29b-41d4-a716-446655440000',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x',
  ])('no: %s', text => expect(detectBase64File(text)).toBe(false));

  it('yes for keys made by node:crypto, as Base64 DER', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    expect(detectBase64File(der(ec.privateKey.export({ type: 'pkcs8', format: 'der' })))).toBe(true);
    expect(detectBase64File(der(ec.publicKey.export({ type: 'spki', format: 'der' })))).toBe(true);
  });

  it('linear on a long input: 16 Mi characters in well under a second', () => {
    const text = `JVBERi0xLjcKJcOkw7zDtsOfCg${'A'.repeat(16 * 1024 * 1024 - 32)}`;
    const t = performance.now();
    expect(detectBase64File(text)).toBe(true);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(detectBase64File(`${text}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBe(false);
  });
});
