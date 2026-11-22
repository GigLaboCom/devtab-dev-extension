/**
 * Go, `net/http` (docs/tools/specs/curl-to-code.md §5, «Код»): a whole program. The default client follows redirects
 * and asks for gzip and decompresses it by itself; `Client.Timeout` covers the whole request.
 */
import { formNameWarnings, lower, milliseconds } from './common';
import { goBytes, goString } from '../literals/go';
import type { Clients, Generator } from '../types';

const goDuration = (seconds: number): string =>
  Number.isInteger(seconds) ? `${seconds} * time.Second` : `${milliseconds(seconds)} * time.Millisecond`;

const FATAL = '\tif err != nil {\n\t\tlog.Fatal(err)\n\t}';

const go: Generator = {
  generate(request) {
    const imports = new Set(['fmt', 'io', 'log', 'net/http']);
    const main: string[] = [];
    const after: string[] = [];
    const body = request.body;
    let bodyArg = 'nil';
    if (body?.kind === 'raw') {
      imports.add('strings');
      main.push(`\tbody := strings.NewReader(${goString(body.text)})`);
      bodyArg = 'body';
    } else if (body?.kind === 'binary') {
      imports.add('strings');
      main.push(`\tbody := strings.NewReader(${goBytes(body.bytes)})`);
      bodyArg = 'body';
    } else if (body?.kind === 'file') {
      imports.add('bytes').add('os');
      main.push(`\tdata, err := os.ReadFile(${goString(body.path)})`, FATAL);
      if (body.strip)
        main.push(
          '\tdata = bytes.ReplaceAll(data, []byte("\\r"), nil)',
          '\tdata = bytes.ReplaceAll(data, []byte("\\n"), nil)',
        );
      main.push('\tbody := bytes.NewReader(data)');
      bodyArg = 'body';
    } else if (body?.kind === 'multipart') {
      imports.add('bytes').add('mime/multipart');
      main.push('\tvar body bytes.Buffer', '\tform := multipart.NewWriter(&body)');
      for (const f of body.fields)
        main.push(
          'file' in f
            ? `\taddFile(form, ${goString(f.name)}, ${goString(f.file)}, ${goString(f.filename)})`
            : `\tform.WriteField(${goString(f.name)}, ${goString(f.value)})`,
        );
      main.push('\tform.Close()');
      bodyArg = '&body';
      if (body.fields.some(f => 'file' in f)) {
        imports.add('os');
        after.push(
          '',
          'func addFile(form *multipart.Writer, field, path, filename string) {',
          '\tdata, err := os.ReadFile(path)',
          FATAL,
          '\tpart, err := form.CreateFormFile(field, filename)',
          FATAL,
          '\tpart.Write(data)',
          '}',
        );
      }
    }
    main.push(
      `\treq, err := http.NewRequest(${goString(request.method)}, ${goString(request.url)}, ${bodyArg})`,
      FATAL,
    );
    if (body?.kind === 'multipart') main.push('\treq.Header.Set("Content-Type", form.FormDataContentType())');
    for (const [name, value] of request.headers)
      main.push(
        lower(name) === 'host'
          ? `\treq.Host = ${goString(value)}`
          : `\treq.Header.Set(${goString(name)}, ${goString(value)})`,
      );
    if (request.user) main.push(`\treq.SetBasicAuth(${goString(request.user[0])}, ${goString(request.user[1])})`);
    main.push('');

    let client = 'http.DefaultClient';
    if (request.timeoutSeconds !== null || request.insecure) {
      const fields: string[] = [];
      if (request.timeoutSeconds !== null) {
        imports.add('time');
        fields.push(`\t\tTimeout: ${goDuration(request.timeoutSeconds)},`);
      }
      if (request.insecure) {
        imports.add('crypto/tls');
        fields.push(
          '\t\tTransport: &http.Transport{',
          '\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},',
          '\t\t},',
        );
      }
      main.push('\tclient := &http.Client{', ...fields, '\t}');
      client = 'client';
    }
    main.push(
      `\tresp, err := ${client}.Do(req)`,
      FATAL,
      '\tdefer resp.Body.Close()',
      '\tout, err := io.ReadAll(resp.Body)',
      FATAL,
      '\tfmt.Printf("%s\\n", out)',
    );
    const sorted = [...imports].sort();
    const text = [
      'package main',
      '',
      'import (',
      ...sorted.map(i => `\t"${i}"`),
      ')',
      '',
      'func main() {',
      ...main,
      '}',
      ...after,
    ].join('\n');
    // mime/multipart escapeQuotes: `\` and `"` with a backslash, line breaks as they are.
    const warnings: string[] =
      body?.kind === 'multipart'
        ? formNameWarnings(
            body.fields,
            "Go's mime/multipart",
            /["\\\r\n]/,
            '" and \\ with a backslash, line breaks as they are',
          )
        : [];
    // net/http sends the query's characters beyond ASCII as UTF-8 bytes, as curl does (checked): no warning.
    return { text: `${text}\n`, warnings };
  },
};

export const clients: Clients = { go };
