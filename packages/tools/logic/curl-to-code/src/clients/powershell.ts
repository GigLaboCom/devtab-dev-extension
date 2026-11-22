/**
 * PowerShell 7+, `Invoke-WebRequest` (docs/tools/specs/curl-to-code.md §5, «Код»): the parameters splatted from a
 * hashtable. Not run on the machine the tool was written on (no PowerShell there); the rules are from the cmdlet's
 * documentation and .NET's:
 *
 * - `-SkipHeaderValidation` lets the headers through as written (Content-Type, User-Agent and the rest);
 * - a string body is encoded by the cmdlet with a charset that changed between versions, so a body that is not ASCII
 *   is passed as its UTF-8 bytes;
 * - .NET sends header values only as ASCII: a header that is not ASCII is left out, with a warning;
 * - `-TimeoutSec` takes whole seconds (rounded up, with a warning); `-SkipCertificateCheck` is `-k`; redirects are
 *   followed by default;
 * - `-Form` takes an ordered dictionary: one key per name (repeated names become one key with several values, sent
 *   together), and a file part is named after its file.
 */
import { formNameWarnings, nonAsciiHeader, queryWarnings } from './common';
import { isAscii } from '../literals/common';
import { psBytes, psString } from '../literals/powershell';
import type { Clients, FormField, Generator } from '../types';

const basename = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** `-Method` takes these (WebRequestMethod); any other is `-CustomMethod`. */
const METHODS: Readonly<Record<string, string>> = {
  GET: 'Get',
  HEAD: 'Head',
  POST: 'Post',
  PUT: 'Put',
  DELETE: 'Delete',
  TRACE: 'Trace',
  OPTIONS: 'Options',
  MERGE: 'Merge',
  PATCH: 'Patch',
};

const utf8Bytes = (text: string): string => `[System.Text.Encoding]::UTF8.GetBytes(${psString(text)})`;

const powershell: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const params: string[] = [`Uri = ${psString(request.url)}`];
    if (request.method !== 'GET')
      params.push(
        METHODS[request.method]
          ? `Method = ${psString(METHODS[request.method]!)}`
          : `CustomMethod = ${psString(request.method)}`,
      );

    const headers: string[] = [];
    for (const [name, value] of request.headers) {
      if (isAscii(value)) headers.push(`${psString(name)} = ${psString(value)}`);
      else warnings.push(nonAsciiHeader(name, 'Invoke-WebRequest'));
    }
    if (request.user)
      headers.push(
        `'Authorization' = 'Basic ' + [Convert]::ToBase64String(${utf8Bytes(`${request.user[0]}:${request.user[1]}`)})`,
      );
    if (headers.length > 0) params.push(`Headers = @{\n${headers.map(h => `        ${h}\n`).join('')}    }`);

    const body = request.body;
    if (body?.kind === 'raw') params.push(`Body = ${isAscii(body.text) ? psString(body.text) : utf8Bytes(body.text)}`);
    else if (body?.kind === 'binary') params.push(`Body = ${psBytes(body.bytes)}`);
    else if (body?.kind === 'file')
      params.push(
        body.strip
          ? `Body = [byte[]]((Get-Content -LiteralPath ${psString(body.path)} -AsByteStream -Raw) | Where-Object { $_ -ne 13 -and $_ -ne 10 })`
          : `InFile = ${psString(body.path)}`,
      );
    else if (body?.kind === 'multipart') {
      const byName = new Map<string, FormField[]>();
      for (const f of body.fields) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
      const value = (f: FormField): string =>
        'file' in f ? `(Get-Item -LiteralPath ${psString(f.file)})` : psString(f.value);
      const entries = [...byName].map(([name, fields]) => {
        if (fields.length > 1)
          warnings.push(`-F ${name}: Invoke-WebRequest sends the fields of one name together; the order differs.`);
        return `${psString(name)} = ${fields.length > 1 ? `@(${fields.map(value).join(', ')})` : value(fields[0]!)}`;
      });
      for (const f of body.fields)
        if ('file' in f && f.filename !== basename(f.file))
          warnings.push(
            `-F ${f.name}: Invoke-WebRequest names the file after its path; filename=${f.filename} is left out.`,
          );
      params.push(`Form = [ordered]@{\n${entries.map(e => `        ${e}\n`).join('')}    }`);
      warnings.push(
        ...formNameWarnings(
          body.fields,
          'Invoke-WebRequest',
          /[^\x20-\x7e]|["\\]/,
          'MIME-encoded (RFC 2047) or quoted, as .NET does',
        ),
      );
    }
    if (headers.length > 0) params.push('SkipHeaderValidation = $true');
    if (request.insecure) params.push('SkipCertificateCheck = $true');
    if (request.timeoutSeconds !== null) {
      const seconds = Math.ceil(request.timeoutSeconds);
      params.push(`TimeoutSec = ${seconds}`);
      if (seconds !== request.timeoutSeconds)
        warnings.push(
          `-m ${request.timeoutSeconds}: Invoke-WebRequest takes whole seconds; the code waits ${seconds}.`,
        );
    }
    const text = [
      '# PowerShell 7 or later',
      '$params = @{',
      ...params.map(p => `    ${p}`),
      '}',
      '$response = Invoke-WebRequest @params',
      '$response.Content',
    ].join('\n');
    warnings.push(...queryWarnings(request.url, 'Invoke-WebRequest'));
    return { text: `${text}\n`, warnings: [...new Set(warnings)] };
  },
};

export const clients: Clients = { powershell };
