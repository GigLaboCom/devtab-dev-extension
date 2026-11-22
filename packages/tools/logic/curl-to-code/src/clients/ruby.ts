/**
 * Ruby, `Net::HTTP` from the standard library (docs/tools/specs/curl-to-code.md §5, «Код»). Checked against a loopback
 * server with Ruby 2.6: it sends header values as UTF-8 and a body with any method, writes Content-Length itself and
 * drops a Transfer-Encoding header, adds `Content-Type: application/x-www-form-urlencoded` to a body without one,
 * asks for gzip and decompresses it (unless the command sets Accept-Encoding), and follows no redirects. `URI()` takes
 * only an RFC 3986 address. `Timeout.timeout` bounds the whole exchange. A form is `set_form(…, 'multipart/form-data')`,
 * which escapes `"` and `\` of a name with a backslash where curl writes %22.
 */
import {
  asciiUrl,
  bodyWithoutType,
  defaultType,
  formNameWarnings,
  noRedirects,
  queryWarnings,
  screenHeaders,
  strictUrl,
} from './common';
import { rubyBytes, rubyString } from '../literals/ruby';
import type { Clients, Generator } from '../types';

const CLASSES: Readonly<Record<string, string>> = {
  GET: 'Get',
  HEAD: 'Head',
  POST: 'Post',
  PUT: 'Put',
  DELETE: 'Delete',
  OPTIONS: 'Options',
  TRACE: 'Trace',
  PATCH: 'Patch',
};
const RULES = { 'content-length': 'own', 'transfer-encoding': 'own' } as const;

const ruby: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const requires = new Set(["require 'net/http'"]);
    // URI() takes only ASCII: the rest is percent-encoded, as curl does in the path.
    const url = asciiUrl(request.url);
    const lines: string[] = [`uri = URI(${rubyString(url)})`];
    if (!strictUrl(url, false))
      warnings.push("The URL has characters Ruby's URI refuses (spaces, quotes, braces…); percent-encode them.");
    warnings.push(...queryWarnings(request.url, 'the code'));
    const body = request.body;
    const cls = CLASSES[request.method];
    lines.push(
      cls
        ? `request = Net::HTTP::${cls}.new(uri)`
        : `request = Net::HTTPGenericRequest.new(${rubyString(request.method)}, ${body ? 'true' : 'false'}, true, uri)`,
    );
    for (const [name, value] of screenHeaders(request.headers, 'Net::HTTP', RULES, warnings))
      lines.push(`request[${rubyString(name)}] = ${rubyString(value)}`);
    if (request.user) lines.push(`request.basic_auth(${rubyString(request.user[0])}, ${rubyString(request.user[1])})`);

    if (body?.kind === 'raw') lines.push(`request.body = ${rubyString(body.text)}`);
    else if (body?.kind === 'binary') lines.push(`request.body = ${rubyBytes(body.bytes)}`);
    else if (body?.kind === 'file')
      lines.push(`request.body = File.binread(${rubyString(body.path)})${body.strip ? '.delete("\\r\\n")' : ''}`);
    else if (body?.kind === 'multipart') {
      const fields = body.fields.map(f =>
        'file' in f
          ? `  [${rubyString(f.name)}, File.open(${rubyString(f.file)}), { filename: ${rubyString(f.filename)} }],`
          : `  [${rubyString(f.name)}, ${rubyString(f.value)}],`,
      );
      lines.push('request.set_form([', ...fields, "], 'multipart/form-data')");
      warnings.push(
        ...formNameWarnings(
          body.fields,
          'Net::HTTP',
          /["\\\r\n]/,
          '" and \\ with a backslash, line breaks as they are',
        ),
      );
    }
    if (bodyWithoutType(request)) warnings.push(defaultType('Net::HTTP'));

    const start = ['uri.hostname', 'uri.port', "use_ssl: uri.scheme == 'https'"];
    if (request.insecure) {
      requires.add("require 'openssl'");
      start.push('verify_mode: OpenSSL::SSL::VERIFY_NONE');
    }
    const exchange = [`Net::HTTP.start(${start.join(', ')}) do |http|`, '  http.request(request)', 'end'];
    lines.push('');
    if (request.timeoutSeconds !== null) {
      requires.add("require 'timeout'");
      lines.push(`response = Timeout.timeout(${request.timeoutSeconds}) do`, ...exchange.map(l => `  ${l}`), 'end');
    } else lines.push(`response = ${exchange[0]}`, ...exchange.slice(1));
    lines.push('puts response.body');
    if (request.followRedirects) warnings.push(noRedirects('Net::HTTP'));
    return { text: `${[...requires].join('\n')}\n\n${lines.join('\n')}\n`, warnings: [...new Set(warnings)] };
  },
};

export const clients: Clients = { ruby };
