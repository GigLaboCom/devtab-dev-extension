/**
 * Kotlin, OkHttp 4 (docs/tools/specs/curl-to-code.md §5, «Код»). Not compiled on the machine the tool was written on (no
 * Kotlin compiler there); the rules are from OkHttp's documentation and sources (`BridgeInterceptor`, `Headers`,
 * `HttpMethod`):
 *
 * - a body is made without a media type (`toRequestBody()`), so the Content-Type of the command is the one sent;
 * - OkHttp writes Content-Length or Transfer-Encoding from the body itself, and sets Host, Connection, Accept-Encoding
 *   and User-Agent only when the command does not;
 * - `addHeader` takes ASCII only; a header that is not ASCII goes through `Headers.Builder.addUnsafeNonAscii`, which
 *   OkHttp writes as UTF-8;
 * - GET and HEAD cannot have a body; POST, PUT and PATCH must have one (an empty one when the command has none);
 * - `Credentials.basic` encodes Latin-1 unless told UTF-8; `callTimeout` covers the whole call; redirects are
 *   followed and gzip is asked for and decompressed by default.
 */
import { milliseconds, noBodyWith, queryWarnings, screenHeaders } from './common';
import { isAscii } from '../literals/common';
import { kotlinBytes, kotlinString } from '../literals/kotlin';
import type { Clients, Generator } from '../types';

const RULES = { 'content-length': 'own', 'transfer-encoding': 'own' } as const;
const HELPERS: Readonly<Record<string, string>> = { POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete' };

const kotlin: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const imports = new Set(['okhttp3.OkHttpClient', 'okhttp3.Request']);
    const main: string[] = [];
    const body = request.body;
    const method = request.method;

    // The body.
    let bodyExpr: string | null = null;
    if (body && (method === 'GET' || method === 'HEAD')) warnings.push(noBodyWith('OkHttp', method));
    else if (body?.kind === 'raw') {
      imports.add('okhttp3.RequestBody.Companion.toRequestBody');
      bodyExpr = `${kotlinString(body.text)}.toRequestBody()`;
    } else if (body?.kind === 'binary') {
      imports.add('okhttp3.RequestBody.Companion.toRequestBody');
      bodyExpr = `${kotlinBytes(body.bytes)}.toRequestBody()`;
    } else if (body?.kind === 'file') {
      imports.add('java.io.File');
      if (body.strip) {
        imports.add('okhttp3.RequestBody.Companion.toRequestBody');
        bodyExpr = `File(${kotlinString(body.path)}).readBytes().filter { it != 10.toByte() && it != 13.toByte() }.toByteArray().toRequestBody()`;
      } else {
        imports.add('okhttp3.RequestBody.Companion.asRequestBody');
        bodyExpr = `File(${kotlinString(body.path)}).asRequestBody()`;
      }
    } else if (body?.kind === 'multipart') {
      imports.add('okhttp3.MultipartBody');
      main.push('val form = MultipartBody.Builder()', '    .setType(MultipartBody.FORM)');
      for (const f of body.fields) {
        if ('file' in f) {
          imports.add('java.io.File').add('okhttp3.RequestBody.Companion.asRequestBody');
          main.push(
            `    .addFormDataPart(${kotlinString(f.name)}, ${kotlinString(f.filename)}, File(${kotlinString(f.file)}).asRequestBody())`,
          );
        } else main.push(`    .addFormDataPart(${kotlinString(f.name)}, ${kotlinString(f.value)})`);
      }
      main.push('    .build()');
      bodyExpr = 'form';
    }
    if (!bodyExpr && ['POST', 'PUT', 'PATCH'].includes(method)) {
      imports.add('okhttp3.RequestBody.Companion.toRequestBody');
      bodyExpr = '"".toRequestBody()';
    }

    // The client.
    const builder: string[] = [];
    if (request.insecure) {
      for (const i of [
        'java.security.cert.X509Certificate',
        'javax.net.ssl.SSLContext',
        'javax.net.ssl.TrustManager',
        'javax.net.ssl.X509TrustManager',
      ])
        imports.add(i);
      main.push(
        '// -k: accepts every certificate and host name.',
        'val trustAll = object : X509TrustManager {',
        '    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}',
        '    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}',
        '    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()',
        '}',
        'val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(trustAll), null) }',
      );
      builder.push('.sslSocketFactory(ssl.socketFactory, trustAll)', '.hostnameVerifier { _, _ -> true }');
    }
    if (request.timeoutSeconds !== null) {
      imports.add('java.util.concurrent.TimeUnit');
      builder.push(`.callTimeout(${milliseconds(request.timeoutSeconds)}, TimeUnit.MILLISECONDS)`);
    }
    main.push(
      builder.length === 0
        ? 'val client = OkHttpClient()'
        : `val client = OkHttpClient.Builder()\n${builder.map(b => `    ${b}\n`).join('')}    .build()`,
    );

    // The request.
    const calls = [`.url(${kotlinString(request.url)})`];
    const helper = HELPERS[method];
    if (method === 'HEAD') calls.push('.head()');
    else if (helper && (bodyExpr || method === 'DELETE')) calls.push(`.${helper}(${bodyExpr ?? ''})`);
    else if (method !== 'GET') calls.push(`.method(${kotlinString(method)}, ${bodyExpr ?? 'null'})`);
    const headers = screenHeaders(request.headers, 'OkHttp', RULES, warnings);
    const all: Array<[string, string]> = [...headers];
    const basic = request.user
      ? `Credentials.basic(${kotlinString(request.user[0])}, ${kotlinString(request.user[1])}, Charsets.UTF_8)`
      : null;
    if (basic) imports.add('okhttp3.Credentials');
    if (all.some(([, v]) => !isAscii(v))) {
      imports.add('okhttp3.Headers');
      main.push(
        'val headers = Headers.Builder()',
        ...all.map(([n, v]) =>
          isAscii(v)
            ? `    .add(${kotlinString(n)}, ${kotlinString(v)})`
            : `    .addUnsafeNonAscii(${kotlinString(n)}, ${kotlinString(v)})`,
        ),
        ...(basic ? [`    .add("Authorization", ${basic})`] : []),
        '    .build()',
      );
      calls.push('.headers(headers)');
    } else {
      for (const [n, v] of all) calls.push(`.addHeader(${kotlinString(n)}, ${kotlinString(v)})`);
      if (basic) calls.push(`.header("Authorization", ${basic})`);
    }
    calls.push('.build()');
    main.push(
      `val request = Request.Builder()\n${calls
        .map(c => `    ${c}\n`)
        .join('')
        .trimEnd()}`,
      'client.newCall(request).execute().use { response ->',
      '    println(response.body?.string())',
      '}',
    );
    const text = [
      '// build.gradle.kts: implementation("com.squareup.okhttp3:okhttp:4.12.0")',
      '',
      ...[...imports].sort().map(i => `import ${i}`),
      '',
      'fun main() {',
      ...main.flatMap(block => block.split('\n')).map(l => `    ${l}`),
      '}',
    ].join('\n');
    warnings.push(...queryWarnings(request.url, 'OkHttp'));
    return { text: `${text}\n`, warnings };
  },
};

export const clients: Clients = { kotlin };
