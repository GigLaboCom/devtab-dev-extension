/**
 * Swift, `URLSession` (Swift 5.7+, top-level `await`; docs/tools/specs/curl-to-code.md §5, «Код»). Checked against a
 * loopback server with Swift 6.4 on macOS: it sets Connection, Content-Length and Transfer-Encoding itself, refuses a
 * body with GET, adds `Content-Type: application/x-www-form-urlencoded` to a POST body without one (not to a PUT),
 * sends `post` as POST, sends a header's
 * characters as Latin-1 bytes (so UTF-8 bytes are written as such), asks for gzip, deflate and br and decompresses
 * them, and follows redirects. `timeoutIntervalForResource` bounds the whole request (a request's own
 * `timeoutInterval` is an idle timeout). It has no form: the parts are written as curl writes them.
 */
import {
  bodyWithoutType,
  capitals,
  defaultType,
  noBodyWith,
  partHead,
  queryWarnings,
  screenHeaders,
  utf8,
  utf8Header,
} from './common';
import { isAscii } from '../literals/common';
import { swiftBytes, swiftString } from '../literals/swift';
import type { Clients, Generator } from '../types';

const RULES = { connection: 'own', 'content-length': 'own', 'transfer-encoding': 'own' } as const;
/** Sent in capitals however written (checked for POST; the others as fetch normalizes them). */
const STANDARD = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);

/** The UTF-8 bytes of a text as Latin-1 characters, 0x80–0xFF as `\u{HH}`. */
const swiftLatin1 = (text: string): string => {
  let latin1 = '';
  for (const b of utf8.encode(text)) latin1 += String.fromCharCode(b);
  return swiftString(latin1).replace(/[\x80-\xff]/g, c => `\\u{${c.charCodeAt(0).toString(16).toUpperCase()}}`);
};

const fileData = (path: string): string => `try Data(contentsOf: URL(fileURLWithPath: ${swiftString(path)}))`;

const swift: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const lines: string[] = [];
    const after: string[] = [];
    const body = request.body;
    lines.push(`var request = URLRequest(url: URL(string: ${swiftString(request.url)})!)`);
    if (request.method !== 'GET') lines.push(`request.httpMethod = ${swiftString(request.method)}`);
    if (STANDARD.has(request.method.toUpperCase()) && request.method !== request.method.toUpperCase())
      warnings.push(capitals('URLSession', request.method));
    for (const [name, value] of screenHeaders(request.headers, 'URLSession', RULES, warnings)) {
      if (isAscii(value))
        lines.push(`request.setValue(${swiftString(value)}, forHTTPHeaderField: ${swiftString(name)})`);
      else {
        warnings.push(utf8Header(name, 'URLSession'));
        lines.push(`request.setValue(${swiftLatin1(value)}, forHTTPHeaderField: ${swiftString(name)})`);
      }
    }
    if (request.user)
      lines.push(
        `request.setValue("Basic " + Data(${swiftString(`${request.user[0]}:${request.user[1]}`)}.utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")`,
      );

    if (body && (request.method === 'GET' || request.method === 'HEAD'))
      warnings.push(noBodyWith('URLSession', request.method));
    else if (body?.kind === 'raw') lines.push(`request.httpBody = Data(${swiftString(body.text)}.utf8)`);
    else if (body?.kind === 'binary') lines.push(`request.httpBody = ${swiftBytes(body.bytes)}`);
    else if (body?.kind === 'file')
      lines.push(`request.httpBody = ${fileData(body.path)}${body.strip ? '.filter { $0 != 10 && $0 != 13 }' : ''}`);
    else if (body?.kind === 'multipart') {
      lines.push(
        'let boundary = UUID().uuidString',
        'let parts: [(String, Data)] = try [',
        ...body.fields.map(
          f =>
            `    (${swiftString(partHead(f))}, ${'file' in f ? fileData(f.file).replace(/^try /, '') : `Data(${swiftString(f.value)}.utf8)`}),`,
        ),
        ']',
        'var form = Data()',
        'for (head, content) in parts {',
        '    form.append(Data("--\\(boundary)\\r\\n\\(head)\\r\\n\\r\\n".utf8))',
        '    form.append(content)',
        '    form.append(Data("\\r\\n".utf8))',
        '}',
        'form.append(Data("--\\(boundary)--\\r\\n".utf8))',
        'request.setValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: "Content-Type")',
        'request.httpBody = form',
      );
    }
    if (request.method === 'POST' && bodyWithoutType(request)) warnings.push(defaultType('URLSession'));

    let session = 'URLSession.shared';
    if (request.timeoutSeconds !== null || request.insecure) {
      lines.push('', 'let configuration = URLSessionConfiguration.default');
      if (request.timeoutSeconds !== null)
        lines.push(`configuration.timeoutIntervalForResource = ${request.timeoutSeconds}`);
      lines.push(
        `let session = URLSession(configuration: configuration${request.insecure ? ', delegate: TrustAll(), delegateQueue: nil' : ''})`,
      );
      session = 'session';
    }
    if (request.insecure)
      after.push(
        '',
        '// -k: accepts every certificate.',
        'final class TrustAll: NSObject, URLSessionDelegate {',
        '    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async',
        '        -> (URLSession.AuthChallengeDisposition, URLCredential?)',
        '    {',
        '        guard let trust = challenge.protectionSpace.serverTrust else { return (.performDefaultHandling, nil) }',
        '        return (.useCredential, URLCredential(trust: trust))',
        '    }',
        '}',
      );
    lines.push(
      '',
      `let (data, _) = try await ${session}.data(for: request)`,
      'print(String(decoding: data, as: UTF8.self))',
    );
    const text = [
      'import Foundation',
      '#if canImport(FoundationNetworking)',
      'import FoundationNetworking',
      '#endif',
      '',
      ...lines,
      ...after,
    ].join('\n');
    warnings.push(...queryWarnings(request.url, "Swift's URL"));
    return { text: `${text}\n`, warnings };
  },
};

export const clients: Clients = { swift };
