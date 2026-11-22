/**
 * Java, `java.net.http.HttpClient` (Java 11+; docs/tools/specs/curl-to-code.md §5, «Код»): a whole program, `Main.java`,
 * run as `java Main.java`. Checked against a loopback server with OpenJDK 25: it refuses the headers Connection,
 * Content-Length, Expect and Upgrade (Host too, unless the system property `jdk.httpclient.allowRestrictedHeaders`
 * names it before the first request — the code sets it), breaks on Transfer-Encoding, sends a header's characters
 * beyond ASCII as `?` (even UTF-8 bytes written as Latin-1 characters), follows no redirects by default and
 * decompresses nothing.
 * It has no multipart form: the parts are written as curl writes them.
 */
import {
  lower,
  milliseconds,
  noDecompress,
  nonAsciiHeader,
  partHead,
  queryWarnings,
  screenHeaders,
  strictUrl,
} from './common';
import { isAscii } from '../literals/common';
import { javaBytes, javaString } from '../literals/java';
import type { Clients, Generator } from '../types';

const CLIENT = "Java's HttpClient";
const RULES = {
  connection: 'refused',
  'content-length': 'refused',
  expect: 'refused',
  upgrade: 'refused',
  'transfer-encoding': 'refused',
} as const;

const PUBLISHERS = 'HttpRequest.BodyPublishers';

const java: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const imports = new Set([
      'java.net.URI',
      'java.net.http.HttpClient',
      'java.net.http.HttpRequest',
      'java.net.http.HttpResponse',
    ]);
    const properties: string[] = [];
    const main: string[] = [];
    const helpers: string[] = [];
    const helper = (...lines: string[]): void => void helpers.push(...(helpers.length > 0 ? [''] : []), ...lines);
    const headers = screenHeaders(request.headers, CLIENT, RULES, warnings);
    if (headers.some(([n]) => lower(n) === 'host'))
      properties.push('System.setProperty("jdk.httpclient.allowRestrictedHeaders", "host");');
    if (!strictUrl(request.url, true))
      warnings.push('The URL has characters java.net.URI refuses (spaces, quotes, braces…); percent-encode them.');

    // The body.
    const body = request.body;
    let publisher: string | null = null;
    if (body?.kind === 'raw') publisher = `${PUBLISHERS}.ofString(${javaString(body.text)})`;
    else if (body?.kind === 'binary') publisher = `${PUBLISHERS}.ofByteArray(${javaBytes(body.bytes)})`;
    else if (body?.kind === 'file') {
      imports.add('java.nio.file.Path');
      if (body.strip) {
        imports.add('java.io.ByteArrayOutputStream').add('java.nio.file.Files');
        publisher = `${PUBLISHERS}.ofByteArray(withoutLineBreaks(Files.readAllBytes(Path.of(${javaString(body.path)}))))`;
        helper(
          '    static byte[] withoutLineBreaks(byte[] data) {',
          '        ByteArrayOutputStream out = new ByteArrayOutputStream();',
          "        for (byte b : data) if (b != '\\r' && b != '\\n') out.write(b);",
          '        return out.toByteArray();',
          '    }',
        );
      } else publisher = `${PUBLISHERS}.ofFile(Path.of(${javaString(body.path)}))`;
    } else if (body?.kind === 'multipart') {
      imports.add('java.io.ByteArrayOutputStream').add('java.io.IOException').add('java.util.UUID');
      imports.add('java.nio.charset.StandardCharsets');
      if (body.fields.some(f => 'file' in f)) imports.add('java.nio.file.Files').add('java.nio.file.Path');
      main.push(
        'String boundary = UUID.randomUUID().toString();',
        'ByteArrayOutputStream form = new ByteArrayOutputStream();',
      );
      for (const f of body.fields)
        main.push(
          `part(form, boundary, ${javaString(partHead(f))}, ${
            'file' in f
              ? `Files.readAllBytes(Path.of(${javaString(f.file)}))`
              : `${javaString(f.value)}.getBytes(StandardCharsets.UTF_8)`
          });`,
        );
      main.push('form.write(("--" + boundary + "--\\r\\n").getBytes(StandardCharsets.UTF_8));');
      publisher = `${PUBLISHERS}.ofByteArray(form.toByteArray())`;
      helper(
        '    static void part(ByteArrayOutputStream form, String boundary, String head, byte[] content) throws IOException {',
        '        form.write(("--" + boundary + "\\r\\n" + head + "\\r\\n\\r\\n").getBytes(StandardCharsets.UTF_8));',
        '        form.write(content);',
        '        form.write("\\r\\n".getBytes(StandardCharsets.UTF_8));',
        '    }',
      );
    }

    // The client.
    const builder: string[] = [];
    if (request.followRedirects) builder.push('.followRedirects(HttpClient.Redirect.ALWAYS)');
    if (request.insecure) {
      imports.add('java.security.cert.X509Certificate').add('javax.net.ssl.SSLContext');
      imports.add('javax.net.ssl.TrustManager').add('javax.net.ssl.X509TrustManager');
      properties.push('System.setProperty("jdk.internal.httpclient.disableHostnameVerification", "true");');
      builder.push('.sslContext(trustAll())');
      helper(
        '    // -k: accepts every certificate and host name.',
        '    static SSLContext trustAll() throws Exception {',
        '        SSLContext ssl = SSLContext.getInstance("TLS");',
        '        ssl.init(null, new TrustManager[] { new X509TrustManager() {',
        '            public void checkClientTrusted(X509Certificate[] chain, String authType) {}',
        '            public void checkServerTrusted(X509Certificate[] chain, String authType) {}',
        '            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }',
        '        } }, null);',
        '        return ssl;',
        '    }',
      );
    }
    main.push(
      builder.length === 0
        ? 'HttpClient client = HttpClient.newHttpClient();'
        : `HttpClient client = HttpClient.newBuilder()\n${builder.map(b => `    ${b}\n`).join('')}    .build();`,
    );

    // The request.
    const calls: string[] = [];
    const method = request.method;
    const noBody = `${PUBLISHERS}.noBody()`;
    if (method === 'GET' && publisher) calls.push(`.method("GET", ${publisher})`);
    else if (method === 'POST') calls.push(`.POST(${publisher ?? noBody})`);
    else if (method === 'PUT') calls.push(`.PUT(${publisher ?? noBody})`);
    else if (method === 'DELETE' && !publisher) calls.push('.DELETE()');
    else if (method !== 'GET') calls.push(`.method(${javaString(method)}, ${publisher ?? noBody})`);
    if (body?.kind === 'multipart') calls.push('.header("Content-Type", "multipart/form-data; boundary=" + boundary)');
    for (const [name, value] of headers) {
      if (isAscii(value)) calls.push(`.header(${javaString(name)}, ${javaString(value)})`);
      else warnings.push(nonAsciiHeader(name, CLIENT));
    }
    if (request.user) {
      imports.add('java.util.Base64').add('java.nio.charset.StandardCharsets');
      calls.push(
        `.header("Authorization", "Basic " + Base64.getEncoder().encodeToString(${javaString(`${request.user[0]}:${request.user[1]}`)}.getBytes(StandardCharsets.UTF_8)))`,
      );
    }
    if (request.timeoutSeconds !== null) {
      imports.add('java.time.Duration');
      calls.push(`.timeout(Duration.ofMillis(${milliseconds(request.timeoutSeconds)}))`);
      warnings.push(`-m: ${CLIENT} times out the wait for the response headers, not the reading of the body.`);
    }
    if (request.compressed) warnings.push(noDecompress(CLIENT));
    warnings.push(...queryWarnings(request.url, CLIENT));
    main.push(
      `HttpRequest request = HttpRequest.newBuilder(URI.create(${javaString(request.url)}))\n${calls.map(c => `    ${c}\n`).join('')}    .build();`,
      'HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());',
      'System.out.println(response.body());',
    );

    const indent = (block: string): string =>
      block
        .split('\n')
        .map(l => `        ${l}`)
        .join('\n');
    const text = [
      '// Java 11 or later: java Main.java',
      '',
      ...[...imports].sort().map(i => `import ${i};`),
      '',
      'public class Main {',
      '    public static void main(String[] args) throws Exception {',
      ...[...properties, ...main].map(indent),
      '    }',
      ...(helpers.length > 0 ? ['', ...helpers] : []),
      '}',
    ].join('\n');
    return { text: `${text}\n`, warnings };
  },
};

export const clients: Clients = { java };
