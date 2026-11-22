// What each client cannot express is a warning that names it, never a silent difference
// (docs/tools/specs/curl-to-code.md §5 «Предупреждения», §15): for every condition of conditions.testing.ts, the exact
// warnings of every one of the seventeen clients — a client missing from a row has none. verify.test.ts checks on a
// loopback server that, where a client is run, the request differs from curl's only as its warnings say.
import { CONDITIONS } from './conditions.testing';
import { ALL_TARGETS, generate, ready } from './testing';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Target } from './types';

beforeAll(ready);

const TABLE: Readonly<Record<string, Partial<Record<Target, readonly string[]>>>> = {
  '-k': {
    javascript: ['-k: fetch cannot skip certificate checks; left out.'],
  },
  '-m 2.5': {
    python: ['-m: requests times out each wait for the server, not the whole request.'],
    'http-client': ['-m: http.client times out each wait for the server, not the whole request.'],
    httpie: ['-m: HTTPie times out each wait for the server, not the whole request.'],
    wget: ['-m: wget times out each wait for the server, not the whole request.'],
    java: ["-m: Java's HttpClient times out the wait for the response headers, not the reading of the body."],
    powershell: ['-m 2.5: Invoke-WebRequest takes whole seconds; the code waits 3.'],
  },
  '--compressed': {
    'http-client': ['--compressed: http.client does not decompress responses; left out.'],
    java: ["--compressed: Java's HttpClient does not decompress responses; left out."],
  },
  '-L': {
    'http-client': ['-L: http.client does not follow redirects; left out.'],
    ruby: ['-L: Net::HTTP does not follow redirects; left out.'],
  },
  '-L with POST': {
    'http-client': ['-L: http.client does not follow redirects; left out.'],
    dart: ["-L: Dart's http follows redirects of GET and HEAD only; this request's are not followed."],
    ruby: ['-L: Net::HTTP does not follow redirects; left out.'],
  },
  'GET with a body': {
    javascript: ['fetch cannot send a body with GET; the body is left out.'],
    node: ["Node's fetch cannot send a body with GET; the body is left out."],
    kotlin: ['OkHttp cannot send a body with GET; the body is left out.'],
    swift: ['URLSession cannot send a body with GET; the body is left out.'],
  },
  'HEAD with a body': {
    javascript: ['fetch cannot send a body with HEAD; the body is left out.'],
    node: ["Node's fetch cannot send a body with HEAD; the body is left out."],
    kotlin: ['OkHttp cannot send a body with HEAD; the body is left out.'],
    swift: ['URLSession cannot send a body with HEAD; the body is left out.'],
  },
  Host: {
    javascript: ['A browser does not let fetch set the Host header (nor does Node).'],
    node: ["The Host header: Node's fetch sets it itself; left out."],
  },
  'Connection: keep-alive': {
    javascript: ['A browser does not let fetch set the Connection header (Node does).'],
    java: ["The Connection header: Java's HttpClient refuses it; left out."],
    swift: ['The Connection header: URLSession sets it itself; left out.'],
  },
  'Content-Length': {
    javascript: ['A browser does not let fetch set the Content-Length header (nor does Node).'],
    node: ["The Content-Length header: Node's fetch sets it itself; left out."],
    java: ["The Content-Length header: Java's HttpClient refuses it; left out."],
    kotlin: ['The Content-Length header: OkHttp sets it itself; left out.'],
    ruby: ['The Content-Length header: Net::HTTP sets it itself; left out.'],
    swift: ['The Content-Length header: URLSession sets it itself; left out.'],
  },
  'Transfer-Encoding': {
    javascript: ['A browser does not let fetch set the Transfer-Encoding header (nor does Node).'],
    node: ["The Transfer-Encoding header: Node's fetch refuses it; left out."],
    java: ["The Transfer-Encoding header: Java's HttpClient refuses it; left out."],
    kotlin: ['The Transfer-Encoding header: OkHttp sets it itself; left out.'],
    ruby: ['The Transfer-Encoding header: Net::HTTP sets it itself; left out.'],
    swift: ['The Transfer-Encoding header: URLSession sets it itself; left out.'],
  },
  'Expect, Upgrade, Keep-Alive': {
    javascript: [
      'A browser does not let fetch set the Expect header (nor does Node).',
      'A browser does not let fetch set the Upgrade header (nor does Node).',
      'A browser does not let fetch set the Keep-Alive header (nor does Node).',
    ],
    node: [
      "The Expect header: Node's fetch refuses it; left out.",
      "The Upgrade header: Node's fetch refuses it; left out.",
      "The Keep-Alive header: Node's fetch refuses it; left out.",
    ],
    java: [
      "The Expect header: Java's HttpClient refuses it; left out.",
      "The Upgrade header: Java's HttpClient refuses it; left out.",
    ],
  },
  'Cookie, Referer, Origin': {
    javascript: [
      'A browser does not let fetch set the Cookie header (Node does).',
      'A browser does not let fetch set the Referer header (Node does).',
      'A browser does not let fetch set the Origin header (Node does).',
    ],
  },
  'a header that is not ASCII': {
    javascript: [
      "The X-Name header is written as UTF-8 bytes, as curl sends it: fetch sends a header's characters as bytes.",
    ],
    node: [
      "The X-Name header is written as UTF-8 bytes, as curl sends it: Node's fetch sends a header's characters as bytes.",
    ],
    axios: [
      "The X-Name header is written as UTF-8 bytes, as curl sends it: Node sends a header's characters as bytes.",
    ],
    java: ["The X-Name header: Java's HttpClient sends only ASCII in a header; left out."],
    powershell: ['The X-Name header: Invoke-WebRequest sends only ASCII in a header; left out.'],
    dart: [
      "The X-Name header is written as UTF-8 bytes, as curl sends it: Dart's http sends a header's characters as bytes.",
    ],
    swift: [
      "The X-Name header is written as UTF-8 bytes, as curl sends it: URLSession sends a header's characters as bytes.",
    ],
  },
  'a body without Content-Type (-T)': {
    javascript: ['The code reads files with node:fs: run it in Node.'],
    axios: ['axios adds Content-Type: application/x-www-form-urlencoded to a body without one.'],
    wget: ['wget adds Content-Type: application/x-www-form-urlencoded to a body without one.'],
    ruby: ['Net::HTTP adds Content-Type: application/x-www-form-urlencoded to a body without one.'],
  },
  'a multipart form': {
    wget: ['wget cannot send a multipart form (-F); the form is left out.'],
  },
  'a form with a repeated name': {
    wget: ['wget cannot send a multipart form (-F); the form is left out.'],
    php: ['-F a: a PHP array cannot repeat a field name; only the last a is sent.'],
    powershell: ['-F a: Invoke-WebRequest sends the fields of one name together; the order differs.'],
  },
  'a file named otherwise, before a text field': {
    javascript: ['The code reads files with node:fs: run it in Node.'],
    httpie: [
      '-F f: HTTPie names the file after its path; filename=other.png is left out.',
      "HTTPie sends a form's text fields before its files; the order differs.",
    ],
    wget: ['wget cannot send a multipart form (-F); the form is left out.'],
    powershell: ['-F f: Invoke-WebRequest names the file after its path; filename=other.png is left out.'],
  },
  'form names with a quote and not ASCII': {
    wget: ['wget cannot send a multipart form (-F); the form is left out.'],
    csharp: [
      '-F n"é: .NET\'s HttpClient writes this form name or file name otherwise than curl (MIME-encoded (RFC 2047) or quoted).',
    ],
    powershell: [
      '-F n"é: Invoke-WebRequest writes this form name or file name otherwise than curl (MIME-encoded (RFC 2047) or quoted, as .NET does).',
    ],
    go: [
      '-F n"é: Go\'s mime/multipart writes this form name or file name otherwise than curl (" and \\ with a backslash, line breaks as they are).',
    ],
    rust: [
      '-F n"é: reqwest writes this form name or file name otherwise than curl (a quote or a line break of a name as it is; " and \\ of a file name with a backslash).',
    ],
    ruby: [
      '-F n"é: Net::HTTP writes this form name or file name otherwise than curl (" and \\ with a backslash, line breaks as they are).',
    ],
  },
  'a method in small letters': {
    axios: ['axios sends the method in capitals: PURGE.'],
    python: ['requests sends the method in capitals: PURGE.'],
    httpie: ['HTTPie sends the method in capitals: PURGE.'],
    wget: ['wget sends the method in capitals: PURGE.'],
  },
  'a standard method in small letters': {
    javascript: ['fetch sends the method in capitals: DELETE.'],
    node: ["Node's fetch sends the method in capitals: DELETE."],
    axios: ['axios sends the method in capitals: DELETE.'],
    python: ['requests sends the method in capitals: DELETE.'],
    httpie: ['HTTPie sends the method in capitals: DELETE.'],
    wget: ['wget sends the method in capitals: DELETE.'],
    swift: ['URLSession sends the method in capitals: DELETE.'],
  },
  'a method that is not a word': {
    httpie: ['HTTPie takes a method of letters only; M-1 will not run.'],
  },
  'a NUL in a header': {
    httpie: ['The X-Nul header has a NUL character, which a command line cannot hold; left out.'],
    wget: ['The X-Nul header has a NUL character, which a command line cannot hold; left out.'],
  },
  'a NUL in the body': {
    wget: ['The body has a NUL character, which a command line cannot hold; left out.'],
  },
  'bytes with NUL': {
    wget: ['The body has a NUL character, which a command line cannot hold; left out.'],
  },
  'a backslash before = in a header': {
    httpie: ['The X-B header: HTTPie cannot write a backslash before ":", ";", "=" or "@"; left out.'],
  },
  'a JSON body that axios would change': {},
  'a URL with a space and a brace': {
    java: ['The URL has characters java.net.URI refuses (spaces, quotes, braces…); percent-encode them.'],
    ruby: ["The URL has characters Ruby's URI refuses (spaces, quotes, braces…); percent-encode them."],
  },
  'a URL that is not ASCII': {},
  'a query that is not ASCII': {
    javascript: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, fetch percent-encodes them.",
    ],
    node: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, Node's fetch percent-encodes them.",
    ],
    axios: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, axios percent-encodes them.",
    ],
    python: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, requests percent-encodes them.",
    ],
    'http-client': [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, the code percent-encodes them.",
    ],
    httpie: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, HTTPie percent-encodes them.",
    ],
    wget: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, wget percent-encodes them.",
    ],
    java: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, Java's HttpClient percent-encodes them.",
    ],
    csharp: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, .NET's HttpClient percent-encodes them.",
    ],
    powershell: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, Invoke-WebRequest percent-encodes them.",
    ],
    rust: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, reqwest percent-encodes them.",
    ],
    kotlin: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, OkHttp percent-encodes them.",
    ],
    dart: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, Dart's Uri percent-encodes them.",
    ],
    ruby: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, the code percent-encodes them.",
    ],
    swift: [
      "The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, Swift's URL percent-encodes them.",
    ],
  },
  'user:password@ in the URL': {
    'http-client': ['http.client does not read user:password@ in the URL; left out.'],
  },
  'an ftp:// URL': {
    'http-client': ['http.client speaks HTTP and HTTPS only; the code uses HTTP for ftp://.'],
  },
  '-m 3 (whole seconds)': {
    python: ['-m: requests times out each wait for the server, not the whole request.'],
    'http-client': ['-m: http.client times out each wait for the server, not the whole request.'],
    httpie: ['-m: HTTPie times out each wait for the server, not the whole request.'],
    wget: ['-m: wget times out each wait for the server, not the whole request.'],
    java: ["-m: Java's HttpClient times out the wait for the response headers, not the reading of the body."],
  },
};

describe('the warnings of every client, condition by condition', () => {
  it('the table has every condition', () =>
    expect(Object.keys(TABLE).sort()).toEqual(CONDITIONS.map(([n]) => n).sort()));
  it.each(CONDITIONS)('%s', (name, request) => {
    const got = Object.fromEntries(
      ALL_TARGETS.map(t => [t, generate(request, t).warnings]).filter(([, w]) => w.length > 0),
    );
    expect(got).toEqual(TABLE[name]);
  });
});
