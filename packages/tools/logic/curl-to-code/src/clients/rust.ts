/**
 * Rust, `reqwest` 0.12 with its blocking client (docs/tools/specs/curl-to-code.md §5, «Код»). It follows redirects by
 * default; it decompresses only with the features for it, which `--compressed` adds to the Cargo line.
 */
import { formNameWarnings, lower, milliseconds, queryWarnings, utf8 } from './common';
import { isAscii } from '../literals/common';
import { rustBytes, rustString } from '../literals/rust';
import type { Clients, Generator } from '../types';

/** reqwest decompresses a response only with these features (and then asks for it in Accept-Encoding). */
const COMPRESSION = ['gzip', 'brotli', 'deflate'];

const RUST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

const rustDuration = (seconds: number): string =>
  Number.isInteger(seconds) ? `Duration::from_secs(${seconds})` : `Duration::from_millis(${milliseconds(seconds)})`;

const rust: Generator = {
  generate(request) {
    const body = request.body;
    const multipart = body?.kind === 'multipart';
    const features = ['blocking', ...(multipart ? ['multipart'] : []), ...(request.compressed ? COMPRESSION : [])];
    const top = [
      `// Cargo.toml: reqwest = { version = "0.12", features = [${features.map(f => `"${f}"`).join(', ')}] }`,
      '',
    ];
    if (request.timeoutSeconds !== null) top.push('use std::time::Duration;', '');
    const main: string[] = ['fn main() -> Result<(), Box<dyn std::error::Error>> {'];
    const warnings: string[] = [];
    if (body?.kind === 'multipart') {
      main.push('    let form = reqwest::blocking::multipart::Form::new()');
      // reqwest percent-encodes a name with a space, a quote, `#%/<>?\`{}`, a control or anything not ASCII into
      // `name*=utf-8''…`; curl writes it as it is. Without encoding reqwest writes it as it is too.
      if (body.fields.some(f => /[\0-\x20"#%/<>?`{}\x7f-\uffff]/.test(f.name)))
        main.push('        .percent_encode_noop()');
      warnings.push(
        ...formNameWarnings(
          body.fields,
          'reqwest',
          /["\r\n]/,
          'a quote or a line break of a name as it is; " and \\ of a file name with a backslash',
          /["\\\r\n]/,
        ),
      );
      body.fields.forEach((f, i) => {
        const end = i === body.fields.length - 1 ? ';' : '';
        main.push(
          'file' in f
            ? `        .file(${rustString(f.name)}, ${rustString(f.file)})?${end}`
            : `        .text(${rustString(f.name)}, ${rustString(f.value)})${end}`,
        );
      });
      if (body.fields.length === 0) main[main.length - 1] += ';';
    }
    if (body?.kind === 'file') {
      main.push(`    let ${body.strip ? 'mut ' : ''}data = std::fs::read(${rustString(body.path)})?;`);
      if (body.strip) main.push("    data.retain(|b| *b != b'\\r' && *b != b'\\n');");
    }
    if (request.timeoutSeconds !== null || request.insecure) {
      main.push('    let client = reqwest::blocking::Client::builder()');
      if (request.insecure) main.push('        .danger_accept_invalid_certs(true)');
      if (request.timeoutSeconds !== null) main.push(`        .timeout(${rustDuration(request.timeoutSeconds)})`);
      main.push('        .build()?;');
    } else main.push('    let client = reqwest::blocking::Client::new();');
    main.push('    let response = client');
    const url = rustString(request.url);
    main.push(
      RUST_METHODS.has(request.method)
        ? `        .${lower(request.method)}(${url})`
        : `        .request(reqwest::Method::from_bytes(${rustBytes(utf8.encode(request.method))})?, ${url})`,
    );
    for (const [name, value] of request.headers)
      main.push(
        `        .header(${rustString(name)}, ${isAscii(value) ? rustString(value) : `${rustString(value)}.as_bytes()`})`,
      );
    if (request.user)
      main.push(`        .basic_auth(${rustString(request.user[0])}, Some(${rustString(request.user[1])}))`);
    if (body?.kind === 'raw') main.push(`        .body(${rustString(body.text)})`);
    else if (body?.kind === 'binary') main.push(`        .body(&${rustBytes(body.bytes)}[..])`);
    else if (body?.kind === 'file') main.push('        .body(data)');
    else if (body?.kind === 'multipart') main.push('        .multipart(form)');
    main.push('        .send()?;', '    println!("{}", response.text()?);', '    Ok(())', '}');
    warnings.push(...queryWarnings(request.url, 'reqwest'));
    return { text: `${[...top, ...main].join('\n')}\n`, warnings };
  },
};

export const clients: Clients = { rust };
