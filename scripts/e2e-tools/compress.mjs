// The Compress / Decompress tool in the built extension (docs/tools/specs/compress.md): its scenarios (§2) the way a
// person does them — the page's real controls — run by scripts/e2e-tools.mjs. The work runs in the package's module
// workers (loaded from their own files: the browser's formats, zstd, brotli; never blob: or data:), so this is also the
// proof that the browser's streams behave as the specification says (§5.3: several gzip members, data after the end)
// and that both wasm modules load under the pages' policy. Save is caught in the page: `showSaveFilePicker` is stubbed
// with a file of the origin's private file system, so no system dialog opens and the saved bytes can be read back.
// The copy button's clipboard is stubbed too; both are restored at the end.

/* global document, location, window, HTMLTextAreaElement, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { mkdirSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.state/e2e/compress');
const T = 'Compress / Decompress';
const HELLO_GZ = 'H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==';
const b64 = bytes => Buffer.from(bytes).toString('base64');

/** A file of `size` zeros, gzip -9, written as a stream (the decompression bomb of §10, row 31). */
const bomb = (path, size) =>
  new Promise((resolve, reject) => {
    const gz = zlib.createGzip({ level: 9 });
    const out = createWriteStream(path);
    gz.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    const chunk = Buffer.alloc(1 << 20);
    let left = size;
    const write = () => {
      while (left > 0) {
        left -= chunk.length;
        if (!gz.write(chunk)) return gz.once('drain', write);
      }
      gz.end();
    };
    write();
  });

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  mkdirSync(OUT, { recursive: true });
  const workers = [];
  page.on('worker', w => workers.push(w.url()));
  const open = async hash => {
    if (page.url().startsWith(base)) await page.evaluate(url => location.replace(url), `${base}${hash}`);
    else await page.goto(`${base}${hash}`);
  };
  await open('#/tools/compress');
  const input = page.locator('#compress-input');
  const result = page.locator('#compress-result');
  // An element of this tool (not the heading): the page shows "Loading…" until its history is open.
  await page.locator('[data-direction]').waitFor({ timeout: 15_000 });
  const group = name => page.getByRole('radiogroup', { name, exact: true });
  const segment = (g, name) => group(g).getByRole('radio', { name, exact: true }).click();
  const part = name => page.locator(`[data-part="${name}"]`).first();
  const text = async name =>
    (
      (await part(name)
        .textContent()
        .catch(() => '')) ?? ''
    ).trim();
  const notes = () => page.locator('[data-part="notes"] [data-slot="tool-message"]').allInnerTexts();
  const pick = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  /** Sets the field as a paste would (React hears the input event) and waits for an answer to this input. */
  const set = async value => {
    await page.evaluate(v => {
      const el = document.querySelector('#compress-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  };
  const resultIs = async want =>
    page
      .waitForFunction(w => document.querySelector('#compress-result')?.value === w, want, { timeout: 15_000 })
      .then(
        () => true,
        () => false,
      );
  const errorIs = async want =>
    page
      .waitForFunction(w => document.querySelector('[data-part="error"]')?.textContent?.trim() === w, want, {
        timeout: 15_000,
      })
      .then(
        () => true,
        async () => `${await text('error')} / ${await result.inputValue()}`,
      );
  await input.waitFor();
  const clipboard = await stubClipboard(page);

  try {
    // ---- §2.1: gzip Base64 → hello, the sizes, the header (Chrome's own streams, in the worker).
    await set(HELLO_GZ);
    check(`${T}: §2.1 gzip Base64 decompresses to hello`, await resultIs('hello'));
    check(
      `${T}: the facts line names the recognised format and the sizes`,
      (await text('sizes')) === 'gzip (recognised by 1f 8b) · 25 bytes → 5 bytes · ratio 0.20 : 1',
      await text('sizes'),
    );
    check(
      `${T}: the gzip header's fields are shown`,
      (await text('header')).includes('Unix (3)'),
      await text('header'),
    );
    check(
      `${T}: the work runs in the package's worker file, not blob: or data:`,
      workers.some(u => /^chrome-extension:\/\/[a-z]+\/assets\/compress\.worker-[\w-]+\.js$/.test(u)),
      workers.join(' '),
    );

    // ---- §10 decompression vectors, in Chrome (§5.3: the browser's own failures are handled as gunzip reads).
    const vectors = [
      ['zlib', 'eJzLSM3JyQcABiwCFQ==', 'hello'],
      ['two gzip members', b64(Buffer.concat([zlib.gzipSync('hello '), zlib.gzipSync('world')])), 'hello world'],
      ['gzip + junk', b64(Buffer.concat([Buffer.from(HELLO_GZ, 'base64'), Buffer.from('xyz')])), 'hello'],
      ['zstd', 'KLUv/SAFKQAAaGVsbG8=', 'hello'],
      [
        'named gzip',
        'H4sIHgDxU2UAAwYAQUICAGhpaGVsbG8udHh0AG1hZGUgYnkgaGFuZAC76/NIzcnJ11EIzy/KSVHkAgCEnui0DgAAAA==',
        'Hello, World!\n',
      ],
    ];
    const got = [];
    for (const [name, value, want] of vectors) {
      await set('');
      await set(value);
      got.push(
        `${name}: ${(await resultIs(want)) ? 'ok' : await result.inputValue()} [${(await notes()).join(' | ')}]`,
      );
    }
    check(
      `${T}: §10 rows 2, 6, 8, 9, 10 in Chrome — zlib, zstd (wasm), every header field, two members, trailing bytes`,
      got.every(g => /: ok/.test(g)),
      got.join('; '),
    );
    const allNotes = got.join(' ');
    check(
      `${T}: §5.3 notes — two members, bytes after the end at their place`,
      allNotes.includes('2 gzip members, decompressed one after another (as gunzip does).') &&
        allNotes.includes('After the end of the gzip data: 3 bytes at byte 26 are not gzip and were ignored.'),
      allNotes,
    );
    const g = Buffer.from(HELLO_GZ, 'base64');
    const errors = [
      [b64(g.subarray(0, -5)), 'The data ends before the end of the compressed stream: it was cut off.'],
      [
        b64(Buffer.concat([g.subarray(0, 17), Buffer.alloc(4), g.subarray(21)])),
        'The CRC-32 in the gzip trailer does not match the data: the data is damaged.',
      ],
      [
        b64(Buffer.concat([g.subarray(0, 21), Buffer.from([9, 0, 0, 0])])),
        'The length in the gzip trailer does not match the data: the data is damaged.',
      ],
      ['eJzLSM3JyQcAAQIDBA==', 'The Adler-32 checksum at the end does not match the data: the data is damaged.'],
      [
        'eLsECQGly0jNyckHAAYsAhU=',
        'This zlib stream needs a preset dictionary (id 0x040901a5), which is not part of the data.',
      ],
      [
        'aGVsbG8=',
        'The format is not recognised: the data does not start like gzip (1f 8b), zlib (78 9c, 78 da, …) or zstd (28 b5 2f fd). Raw deflate and brotli have no signature: choose the format.',
      ],
      ['H4sI!', 'Line 1, column 5: invalid character "!"'],
    ];
    const bad = [];
    for (const [value, want] of errors) {
      await set('');
      await set(value);
      const ok = await errorIs(want);
      if (ok !== true) bad.push(`${want} ≠ ${ok}`);
    }
    check(
      `${T}: §6 errors word for word, from Chrome's streams (cut, CRC-32, ISIZE, Adler-32, dictionary, unknown, Base64)`,
      bad.length === 0,
      bad.join('; '),
    );

    // ---- §2.4: brotli by hand (the decoder's wasm worker).
    await set('CwKAaGVsbG8D');
    await pick('Format', 'brotli');
    check(`${T}: §2.4 brotli, chosen by hand, decompresses in its worker`, await resultIs('hello'));
    check(
      `${T}: zstd and brotli load from their own worker files (wasm built in, no .wasm request)`,
      workers.some(u => /\/assets\/zstd\.worker-[\w-]+\.js$/.test(u)) &&
        workers.some(u => /\/assets\/brotli\.worker-[\w-]+\.js$/.test(u)),
      workers.join(' '),
    );
    await pick('Format', 'Auto — from the first bytes');

    // ---- §2.6: not text → hex, Text off.
    await set(b64(zlib.gzipSync(Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x41]))));
    const hexShown = await resultIs('ff fe fd 00 41');
    check(
      `${T}: §2.6 a result that is not text shows in hex with the note, Text is off`,
      hexShown &&
        (await notes()).includes('Not text: not valid UTF-8 from byte 1.') &&
        (await group('View').getByRole('radio', { name: 'Text', exact: true }).isDisabled()),
      (await notes()).join(' | '),
    );
    await set(HELLO_GZ);
    await resultIs('hello');
    await settledShot(shoot, page, 'tool-compress-01-decompress-light.png');

    // ---- Copy: the shown result, a commit in the history.
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page
      .getByRole('button', { name: 'Copied', exact: true })
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const copied = await clipboard.copied();
    check(`${T}: Copy copies the shown text`, copied.at(-1) === 'hello', JSON.stringify(copied));

    // ---- §2.8: Compress — the same bytes every time (no name, no time, OS 255); zstd; brotli; hex.
    await segment('Direction', 'Compress');
    await set('hello');
    const gz = await resultIs('H4sIAAAAAAAA/8tIzcnJBwCGphA2BQAAAA==');
    await set('hello!');
    await page.waitForFunction(
      () =>
        /^H4sI/.test(document.querySelector('#compress-result')?.value ?? '') &&
        document.querySelector('#compress-result').value !== 'H4sIAAAAAAAA/8tIzcnJBwCGphA2BQAAAA==',
      null,
      { timeout: 10_000 },
    );
    await set('hello');
    const again = await resultIs('H4sIAAAAAAAA/8tIzcnJBwCGphA2BQAAAA==');
    check(
      `${T}: §2.8 Compress hello into gzip gives the specification's bytes, again the same`,
      gz && again,
      await result.inputValue(),
    );
    await segment('View', 'Hex');
    check(`${T}: §10 row 29 the hex of it`, await resultIs('1f8b08000000000000ffcb48cdc9c9070086a6103605000000'));
    await segment('View', 'Base64');
    await pick('Format', 'zstd');
    const zst = await resultIs('KLUv/QBYKQAAaGVsbG8=');
    await pick('Format', 'brotli');
    const br = await resultIs('CwKAaGVsbG8D');
    check(`${T}: §10 rows 27, 28 zstd 3 and brotli 11 in their workers`, zst && br, await result.inputValue());
    check(
      `${T}: brotli compression loads its own worker file`,
      workers.some(u => /\/assets\/brotli-encode\.worker-[\w-]+\.js$/.test(u)),
      workers.join(' '),
    );
    await pick('Format', 'gzip');
    await resultIs('H4sIAAAAAAAA/8tIzcnJBwCGphA2BQAAAA==');
    await settledShot(shoot, page, 'tool-compress-02-compress-light.png');

    // ---- A file, decompressed; the result over 1 MiB is previewed; Save writes it as a stream into the chosen file.
    await segment('Direction', 'Decompress');
    await segment('Input encoding', 'File');
    const plain = Buffer.alloc(3 * 1024 * 1024, 'line of a log file\n');
    const gzPath = join(OUT, 'access.log.gz');
    writeFileSync(gzPath, zlib.gzipSync(plain));
    await page.locator('input[type="file"]').setInputFiles(gzPath);
    await part('too-large')
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    check(
      `${T}: a result over 1 MiB is not shown: the line, the preview of 4 KiB`,
      (await text('too-large')).startsWith('The result is 3 MB: too large to show here. Save it as a file.') &&
        (await result.inputValue()) === plain.subarray(0, 4096).toString(),
      await text('too-large'),
    );
    await page.evaluate(() => {
      window.__saved = [];
      window.showSaveFilePicker = async ({ suggestedName }) => {
        window.__saved.push(suggestedName);
        const root = await navigator.storage.getDirectory();
        return root.getFileHandle('e2e-compress-save.bin', { create: true });
      };
    });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page
      .locator('[data-part="notes"]', { hasText: 'Saved as e2e-compress-save.bin.' })
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    const saved = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const file = await (await root.getFileHandle('e2e-compress-save.bin')).getFile();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      await root.removeEntry('e2e-compress-save.bin');
      return { name: window.__saved.at(-1), size: file.size, digest };
    });
    check(
      `${T}: Save suggests access.log and writes the whole result into the chosen file`,
      saved.name === 'access.log' &&
        saved.size === plain.length &&
        saved.digest === createHash('sha256').update(plain).digest('hex'),
      JSON.stringify(saved),
    );

    // ---- §2.7: a bomb — 256 MiB of zeros under the 1 GiB limit is fine; 1.25 GiB stops with the words of §5.8.
    const bombPath = join(OUT, 'bomb.gz');
    await bomb(bombPath, 1280 * 1024 * 1024);
    const started = Date.now();
    await page.locator('input[type="file"]').setInputFiles(bombPath);
    await part('stopped')
      .waitFor({ timeout: 60_000 })
      .catch(() => {});
    const stopped = await text('stopped');
    check(
      `${T}: §2.7 a gzip bomb (1.25 GiB of zeros) stops at 1 GiB with how much and what ratio`,
      /^Stopped at 1 GiB of output from [\d,]+ bytes of input \(ratio over [\d,]+ : 1\): the tool decompresses at most 1 GiB\. This may be a decompression bomb\.$/.test(
        stopped,
      ),
      `${stopped} (${Date.now() - started} ms)`,
    );
    await settledShot(shoot, page, 'tool-compress-03-bomb-light.png');

    // ---- History: Copy was a commit in clear; an entry opens back into the tool.
    await open('#/tools');
    const entry = await waitForHistoryRecord(page, 'compress', r => r.label?.endsWith('copied')).catch(() => null);
    check(
      `${T}: Copy is recorded in clear with the input and the sizes`,
      !!entry &&
        !entry.sealed &&
        entry.kind === 'decompress' &&
        entry.label === 'Decompress · gzip · 25 bytes → 5 bytes · ratio 0.20 : 1 · copied',
      entry ? `${entry.kind}: ${entry.label}` : 'no record',
    );
    await open('#/tools/compress');
    await page.locator('[data-direction]').waitFor();
    await page.getByText('Recent entries').click();
    await page.locator('.kit-history-entry').first().waitFor();
    await page
      .locator('.kit-history-entry')
      .filter({ hasText: 'Decompress · gzip · 25 bytes → 5 bytes · ratio 0.20 : 1 · copied' })
      .first()
      .getByRole('button', { name: 'Open' })
      .click();
    await page
      .getByText('Opened from History: Decompress · gzip · 25 bytes → 5 bytes · ratio 0.20 : 1 · copied.')
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    check(
      `${T}: the entry opens back with its input, and the result is made again`,
      (await input.inputValue().catch(() => '')) === HELLO_GZ && (await resultIs('hello')),
    );

    // ---- Dark theme.
    await inDarkTheme(ctx, base, page, async () => {
      await set(b64(zlib.gzipSync(Buffer.from([0, 1, 2, 3, 0xff, 0x41, 0x42]))));
      await resultIs('00 01 02 03 ff 41 42');
      await settledShot(shoot, page, 'tool-compress-04-hex-dark.png');
      await segment('Direction', 'Compress');
      await set('{"user": "ada", "roles": ["admin"]}');
      await page.waitForFunction(() => document.querySelector('#compress-result')?.value.startsWith('H4sI'), null, {
        timeout: 10_000,
      });
      await settledShot(shoot, page, 'tool-compress-05-compress-dark.png');
      await segment('Direction', 'Decompress');
    });

    // ---- §7: gzip Base64 pasted into the start page opens this tool in Decompress; text Base64 still opens Base64.
    const paste = async value => {
      await open('#/start');
      const box = page.getByRole('combobox', { name: 'Find a tool or search the web' });
      await box.waitFor();
      await box.focus();
      await page.evaluate(v => {
        const data = new DataTransfer();
        data.setData('text/plain', v);
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, value);
    };
    await paste(HELLO_GZ);
    await page.waitForFunction(() => location.hash === '#/tools/compress', null, { timeout: 5_000 }).catch(() => {});
    await input.waitFor({ timeout: 10_000 }).catch(() => {});
    const pasted = {
      hash: await page.evaluate(() => location.hash),
      result: (await resultIs('hello')) ? 'hello' : await result.inputValue().catch(() => null),
    };
    await paste('SGVsbG8sIFdvcmxkIQ==');
    await page.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 5_000 }).catch(() => {});
    const textB64 = await page.evaluate(() => location.hash);
    check(
      `${T}: §7 gzip Base64 pasted on the start page opens this tool and decompresses it; text Base64 opens Base64`,
      pasted.hash === '#/tools/compress' && pasted.result === 'hello' && textB64 === '#/tools/base64',
      `${JSON.stringify(pasted)} ${textB64}`,
    );
  } finally {
    await page
      .evaluate(() => {
        delete window.showSaveFilePicker;
        delete window.__saved;
      })
      .catch(() => {});
    await clipboard.restore().catch(() => {});
    rmSync(OUT, { recursive: true, force: true });
    void sleep;
  }
};
