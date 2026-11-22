/**
 * PHP, the cURL extension (PHP 7.4+; docs/tools/specs/curl-to-code.md §5, «Код») — libcurl itself, so most options are
 * curl's own: `CURLOPT_USERPWD` (Basic), `CURLOPT_SSL_VERIFYPEER`/`VERIFYHOST`, `CURLOPT_TIMEOUT_MS` (the whole
 * request), `CURLOPT_ENCODING` (`--compressed`), `CURLOPT_FOLLOWLOCATION` (`-L`; like curl, none by default). Not run on
 * the machine the tool was written on (no PHP there); the rules are from the PHP manual and libcurl's:
 *
 * - a string in `CURLOPT_POSTFIELDS` is the body as it is, and libcurl adds `Content-Type:
 *   application/x-www-form-urlencoded` when the command has none — an empty `Content-Type:` line removes it (`-T`);
 * - an array in `CURLOPT_POSTFIELDS` is a multipart form, one value per key: a repeated name cannot be written;
 * - the method is libcurl's guess (POST with a body, GET without), otherwise `CURLOPT_CUSTOMREQUEST`; HEAD is
 *   `CURLOPT_NOBODY`.
 */
import { bodyWithoutType, milliseconds } from './common';
import { phpBytes, phpString } from '../literals/php';
import type { Clients, Generator } from '../types';

const php: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const options: Array<[string, string]> = [];
    const body = request.body;

    if (request.method === 'HEAD') options.push(['CURLOPT_NOBODY', 'true']);
    else if (request.method !== (body ? 'POST' : 'GET'))
      options.push(['CURLOPT_CUSTOMREQUEST', phpString(request.method)]);

    const headers = request.headers.map(([n, v]) => phpString(v === '' ? `${n};` : `${n}: ${v}`));
    if (bodyWithoutType(request)) headers.push(phpString('Content-Type:'));
    if (headers.length > 0)
      options.push(['CURLOPT_HTTPHEADER', `[\n${headers.map(h => `        ${h},\n`).join('')}    ]`]);

    if (body?.kind === 'raw') options.push(['CURLOPT_POSTFIELDS', phpString(body.text)]);
    else if (body?.kind === 'binary') options.push(['CURLOPT_POSTFIELDS', phpBytes(body.bytes)]);
    else if (body?.kind === 'file')
      options.push([
        'CURLOPT_POSTFIELDS',
        body.strip
          ? `str_replace(["\\r", "\\n"], '', file_get_contents(${phpString(body.path)}))`
          : `file_get_contents(${phpString(body.path)})`,
      ]);
    else if (body?.kind === 'multipart') {
      const seen = new Map<string, number>();
      body.fields.forEach(f => seen.set(f.name, (seen.get(f.name) ?? 0) + 1));
      for (const [name, count] of seen)
        if (count > 1)
          warnings.push(`-F ${name}: a PHP array cannot repeat a field name; only the last ${name} is sent.`);
      const fields = body.fields.map(f =>
        'file' in f
          ? `        ${phpString(f.name)} => new CURLFile(${phpString(f.file)}, '', ${phpString(f.filename)}),\n`
          : `        ${phpString(f.name)} => ${phpString(f.value)},\n`,
      );
      options.push(['CURLOPT_POSTFIELDS', `[\n${fields.join('')}    ]`]);
    }
    if (request.user) options.push(['CURLOPT_USERPWD', phpString(`${request.user[0]}:${request.user[1]}`)]);
    if (request.insecure) options.push(['CURLOPT_SSL_VERIFYPEER', 'false'], ['CURLOPT_SSL_VERIFYHOST', '0']);
    if (request.timeoutSeconds !== null)
      options.push(['CURLOPT_TIMEOUT_MS', String(milliseconds(request.timeoutSeconds))]);
    if (request.compressed) options.push(['CURLOPT_ENCODING', "''"]);
    if (request.followRedirects) options.push(['CURLOPT_FOLLOWLOCATION', 'true']);
    options.push(['CURLOPT_RETURNTRANSFER', 'true']);

    const text = [
      '<?php',
      '',
      `$ch = curl_init(${phpString(request.url)});`,
      'curl_setopt_array($ch, [',
      ...options.map(([k, v]) => `    ${k} => ${v},`),
      ']);',
      '$response = curl_exec($ch);',
      'if ($response === false) {',
      '    throw new RuntimeException(curl_error($ch));',
      '}',
      'curl_close($ch);',
      'echo $response;',
    ].join('\n');
    return { text: `${text}\n`, warnings };
  },
};

export const clients: Clients = { php };
