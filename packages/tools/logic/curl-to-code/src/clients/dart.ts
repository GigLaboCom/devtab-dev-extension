/**
 * Dart, `package:http` 1.x (docs/tools/specs/curl-to-code.md §5, «Код»). Not run on the machine the tool was written on
 * (no Dart there); the rules are from the package's documentation and sources and dart:io's:
 *
 * - the body is set as bytes (`bodyBytes`): setting `body` as a string would add `charset=utf-8` to the command's
 *   Content-Type;
 * - a form is a `MultipartRequest` whose parts are all in `files`, in the command's order (its `fields` map would put
 *   text fields first and cannot repeat a name);
 * - dart:io sends a header's characters as bytes, so a value that is not ASCII is written as its UTF-8 bytes;
 * - `-k` is an `IOClient` whose `HttpClient` accepts every certificate; `.timeout()` covers the whole exchange;
 * - redirects are followed by default, but only for GET and HEAD (dart:io); gzip is asked for and decompressed.
 */
import { formNameWarnings, milliseconds, queryWarnings, utf8, utf8Header } from './common';
import { hex2, isAscii } from '../literals/common';
import { dartBytes, dartString } from '../literals/dart';
import type { Clients, Generator } from '../types';

/** The UTF-8 bytes of a text as Latin-1 characters, 0x80–0xFF as `\xHH`. */
const dartLatin1 = (text: string): string => {
  let latin1 = '';
  for (const b of utf8.encode(text)) latin1 += String.fromCharCode(b);
  return dartString(latin1).replace(/[\x80-\xff]/g, c => `\\x${hex2(c.charCodeAt(0)).toUpperCase()}`);
};

const dart: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const imports = new Set(["import 'package:http/http.dart' as http;"]);
    const main: string[] = [];
    const body = request.body;
    const uri = `Uri.parse(${dartString(request.url)})`;
    const method = dartString(request.method);

    if (body?.kind === 'multipart') {
      main.push(`final request = http.MultipartRequest(${method}, ${uri});`);
      for (const f of body.fields)
        main.push(
          'file' in f
            ? `request.files.add(await http.MultipartFile.fromPath(${dartString(f.name)}, ${dartString(f.file)}, filename: ${dartString(f.filename)}));`
            : `request.files.add(http.MultipartFile.fromString(${dartString(f.name)}, ${dartString(f.value)}));`,
        );
      // MultipartRequest writes CR, LF and CRLF of a name all as %0D%0A; curl writes CR as %0D and LF as %0A.
      warnings.push(...formNameWarnings(body.fields, "Dart's http", /[\r\n]/, 'every line break as %0D%0A'));
    } else main.push(`final request = http.Request(${method}, ${uri});`);

    const headers = request.headers.map(([name, value]) => {
      if (isAscii(value)) return `  ${dartString(name)}: ${dartString(value)},`;
      warnings.push(utf8Header(name, "Dart's http"));
      return `  ${dartString(name)}: ${dartLatin1(value)},`;
    });
    if (request.user) {
      imports.add("import 'dart:convert';");
      headers.push(
        `  'Authorization': 'Basic ' + base64Encode(utf8.encode(${dartString(`${request.user[0]}:${request.user[1]}`)})),`,
      );
    }
    if (headers.length > 0) main.push('request.headers.addAll({', ...headers, '});');

    if (body?.kind === 'raw') {
      imports.add("import 'dart:convert';");
      main.push(`request.bodyBytes = utf8.encode(${dartString(body.text)});`);
    } else if (body?.kind === 'binary') main.push(`request.bodyBytes = ${dartBytes(body.bytes)};`);
    else if (body?.kind === 'file') {
      imports.add("import 'dart:io';");
      main.push(
        body.strip
          ? `request.bodyBytes = (await File(${dartString(body.path)}).readAsBytes()).where((b) => b != 10 && b != 13).toList();`
          : `request.bodyBytes = await File(${dartString(body.path)}).readAsBytes();`,
      );
    }

    let send = 'request.send()';
    if (request.insecure) {
      imports.add("import 'dart:io';").add("import 'package:http/io_client.dart';");
      main.push('// -k: accepts every certificate.');
      main.push('final client = IOClient(HttpClient()..badCertificateCallback = (cert, host, port) => true);');
      send = 'client.send(request)';
    }
    const timeout =
      request.timeoutSeconds === null
        ? ''
        : `.timeout(const Duration(milliseconds: ${milliseconds(request.timeoutSeconds)}))`;
    main.push(`final response = await ${send}.then(http.Response.fromStream)${timeout};`, 'print(response.body);');
    if (request.followRedirects && request.method !== 'GET' && request.method !== 'HEAD')
      warnings.push("-L: Dart's http follows redirects of GET and HEAD only; this request's are not followed.");

    const order = (i: string): string => (i.includes("'dart:") ? `0${i}` : `1${i}`);
    const text = [
      '// pubspec.yaml: dependencies: { http: ^1.2.0 }',
      ...[...imports].sort((a, b) => (order(a) < order(b) ? -1 : 1)),
      '',
      'Future<void> main() async {',
      ...main.map(l => `  ${l}`),
      '}',
    ].join('\n');
    warnings.push(...queryWarnings(request.url, "Dart's Uri"));
    return { text: `${text}\n`, warnings };
  },
};

export const clients: Clients = { dart };
