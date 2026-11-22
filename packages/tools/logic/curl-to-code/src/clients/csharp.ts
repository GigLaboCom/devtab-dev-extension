/**
 * C#, `System.Net.Http.HttpClient` (.NET 6+, a top-level program; docs/tools/specs/curl-to-code.md §5, «Код»). Not run
 * on the machine the tool was written on (no .NET there); the rules below are from the .NET documentation:
 *
 * - content headers (Content-Type, Content-Length, Content-Encoding, …) belong to `HttpContent.Headers` — on the request
 *   `TryAddWithoutValidation` refuses them — so they go there, on an empty content when the command has no body;
 * - the body is bytes (`ByteArrayContent`): `StringContent` would add its own `Content-Type` with a charset;
 * - `SocketsHttpHandler` sends header values only as ASCII unless `RequestHeaderEncodingSelector` says UTF-8, skips
 *   certificate checks through `SslOptions`, decompresses only with `AutomaticDecompression`, and with `UseCookies` may
 *   merge its own cookies into a Cookie header (turned off when the command sets one);
 * - `MultipartFormDataContent` writes a field name or file name that is not ASCII MIME-encoded (RFC 2047), and one
 *   with `"` or `\` quoted, not as the bytes curl sends — a warning;
 * - `HttpClient.Timeout` covers the whole request; it follows redirects by default.
 */
import { formNameWarnings, lower, milliseconds, queryWarnings } from './common';
import { isAscii } from '../literals/common';
import { csharpBytes, csharpString } from '../literals/csharp';
import type { Clients, Generator } from '../types';

const CONTENT_HEADERS = new Set([
  'allow',
  'content-disposition',
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-md5',
  'content-range',
  'content-type',
  'expires',
  'last-modified',
]);

const METHODS: Readonly<Record<string, string>> = {
  GET: 'HttpMethod.Get',
  POST: 'HttpMethod.Post',
  PUT: 'HttpMethod.Put',
  DELETE: 'HttpMethod.Delete',
  HEAD: 'HttpMethod.Head',
  OPTIONS: 'HttpMethod.Options',
  PATCH: 'HttpMethod.Patch',
};

const csharp: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const usings = new Set(['System', 'System.Net.Http']);
    const lines: string[] = [];

    // The handler, only when the defaults will not do.
    const handler: string[] = [];
    if (request.compressed) {
      usings.add('System.Net');
      handler.push('AutomaticDecompression = DecompressionMethods.All,');
    }
    if (request.headers.some(([n]) => lower(n) === 'cookie')) handler.push('UseCookies = false,');
    if (request.headers.some(([, v]) => !isAscii(v))) {
      usings.add('System.Text');
      handler.push('RequestHeaderEncodingSelector = (_, _) => Encoding.UTF8,');
    }
    if (request.insecure) handler.push('SslOptions = { RemoteCertificateValidationCallback = (_, _, _, _) => true },');
    if (handler.length > 0)
      lines.push('using var handler = new SocketsHttpHandler', '{', ...handler.map(h => `    ${h}`), '};');
    const timeout =
      request.timeoutSeconds === null
        ? ''
        : ` { Timeout = TimeSpan.FromMilliseconds(${milliseconds(request.timeoutSeconds)}) }`;
    lines.push(`using var client = new HttpClient(${handler.length > 0 ? 'handler' : ''})${timeout};`);
    const method = METHODS[request.method] ?? `new HttpMethod(${csharpString(request.method)})`;
    lines.push(`using var request = new HttpRequestMessage(${method}, ${csharpString(request.url)});`);

    // The body.
    const body = request.body;
    const contentHeaders = request.headers.filter(([n]) => CONTENT_HEADERS.has(lower(n)));
    let content: string | null = null;
    if (body?.kind === 'raw') {
      usings.add('System.Text');
      content = `new ByteArrayContent(Encoding.UTF8.GetBytes(${csharpString(body.text)}))`;
    } else if (body?.kind === 'binary') content = `new ByteArrayContent(${csharpBytes(body.bytes)})`;
    else if (body?.kind === 'file') {
      usings.add('System.IO');
      if (body.strip) usings.add('System.Linq');
      content = body.strip
        ? `new ByteArrayContent(File.ReadAllBytes(${csharpString(body.path)}).Where(b => b != '\\r' && b != '\\n').ToArray())`
        : `new ByteArrayContent(File.ReadAllBytes(${csharpString(body.path)}))`;
    } else if (body?.kind === 'multipart') {
      lines.push('var form = new MultipartFormDataContent();');
      for (const f of body.fields) {
        if ('file' in f) {
          usings.add('System.IO');
          lines.push(
            `form.Add(new ByteArrayContent(File.ReadAllBytes(${csharpString(f.file)})), ${csharpString(f.name)}, ${csharpString(f.filename)});`,
          );
        } else lines.push(`form.Add(new StringContent(${csharpString(f.value)}), ${csharpString(f.name)});`);
      }
      warnings.push(
        ...formNameWarnings(
          body.fields,
          ".NET's HttpClient",
          /[^\x20-\x7e]|["\\]/,
          'MIME-encoded (RFC 2047) or quoted',
        ),
      );
      content = 'form';
    }
    if (!content && contentHeaders.length > 0) content = 'new ByteArrayContent(Array.Empty<byte>())';
    if (content) lines.push(`request.Content = ${content};`);

    for (const [name, value] of request.headers) {
      const target = CONTENT_HEADERS.has(lower(name)) ? 'request.Content.Headers' : 'request.Headers';
      lines.push(`${target}.TryAddWithoutValidation(${csharpString(name)}, ${csharpString(value)});`);
    }
    if (request.user) {
      usings.add('System.Net.Http.Headers').add('System.Text');
      lines.push(
        `request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(${csharpString(`${request.user[0]}:${request.user[1]}`)})));`,
      );
    }
    lines.push(
      '',
      'using var response = await client.SendAsync(request);',
      'Console.WriteLine(await response.Content.ReadAsStringAsync());',
    );
    const text = [
      '// .NET 6 or later: a top-level program.',
      ...[...usings].sort().map(u => `using ${u};`),
      '',
      ...lines,
    ].join('\n');
    warnings.push(...queryWarnings(request.url, ".NET's HttpClient"));
    return { text: `${text}\n`, warnings: [...new Set(warnings)] };
  },
};

export const clients: Clients = { csharp };
