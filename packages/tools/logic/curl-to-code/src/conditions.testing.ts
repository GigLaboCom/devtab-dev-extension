/**
 * For the package's tests only: one request per thing a client may not express (docs/tools/specs/curl-to-code.md §5,
 * «Предупреждения» and §15), for the table of warnings by client (clients.test.ts).
 */
import { request } from './testing';
import type { CurlRequest } from './types';

const post = (over: Partial<CurlRequest>): CurlRequest =>
  request({ method: 'POST', headers: [['Content-Type', 'text/plain']], body: { kind: 'raw', text: 'x' }, ...over });

export const CONDITIONS: ReadonlyArray<[name: string, request: CurlRequest]> = [
  ['-k', request({ insecure: true })],
  ['-m 2.5', request({ timeoutSeconds: 2.5 })],
  ['--compressed', request({ compressed: true })],
  ['-L', request({ followRedirects: true })],
  ['-L with POST', post({ followRedirects: true })],
  ['GET with a body', request({ headers: [['Content-Type', 'text/plain']], body: { kind: 'raw', text: 'x' } })],
  [
    'HEAD with a body',
    request({ method: 'HEAD', headers: [['Content-Type', 'text/plain']], body: { kind: 'raw', text: 'x' } }),
  ],
  ['Host', request({ headers: [['Host', 'h.example']] })],
  ['Connection: keep-alive', request({ headers: [['Connection', 'keep-alive']] })],
  [
    'Content-Length',
    post({
      headers: [
        ['Content-Type', 'text/plain'],
        ['Content-Length', '1'],
      ],
    }),
  ],
  [
    'Transfer-Encoding',
    post({
      headers: [
        ['Content-Type', 'text/plain'],
        ['Transfer-Encoding', 'chunked'],
      ],
    }),
  ],
  [
    'Expect, Upgrade, Keep-Alive',
    request({
      headers: [
        ['Expect', '100-continue'],
        ['Upgrade', 'h2c'],
        ['Keep-Alive', '5'],
      ],
    }),
  ],
  [
    'Cookie, Referer, Origin',
    request({
      headers: [
        ['Cookie', 'a=1'],
        ['Referer', 'https://r.example/'],
        ['Origin', 'https://o.example'],
      ],
    }),
  ],
  ['a header that is not ASCII', request({ headers: [['X-Name', 'Jörg']] })],
  [
    'a body without Content-Type (-T)',
    request({ method: 'PUT', body: { kind: 'file', path: 'up.txt', strip: false } }),
  ],
  ['a multipart form', post({ headers: [], body: { kind: 'multipart', fields: [{ name: 'a', value: '1' }] } })],
  [
    'a form with a repeated name',
    post({
      headers: [],
      body: {
        kind: 'multipart',
        fields: [
          { name: 'a', value: '1' },
          { name: 'a', value: '2' },
        ],
      },
    }),
  ],
  [
    'a file named otherwise, before a text field',
    post({
      headers: [],
      body: {
        kind: 'multipart',
        fields: [
          { name: 'f', file: 'dir/photo.png', filename: 'other.png' },
          { name: 't', value: 'v' },
        ],
      },
    }),
  ],
  [
    'form names with a quote and not ASCII',
    post({ headers: [], body: { kind: 'multipart', fields: [{ name: 'n"é', value: 'v' }] } }),
  ],
  ['a method in small letters', request({ method: 'purge' })],
  ['a standard method in small letters', request({ method: 'delete' })],
  ['a method that is not a word', request({ method: 'M-1' })],
  ['a NUL in a header', request({ headers: [['X-Nul', 'a\u{0}b']] })],
  ['a NUL in the body', post({ body: { kind: 'raw', text: 'a\u{0}b' } })],
  ['bytes with NUL', post({ body: { kind: 'binary', bytes: Uint8Array.of(0, 0xff) } })],
  ['a backslash before = in a header', request({ headers: [['X-B', 'a\\=b']] })],
  [
    'a JSON body that axios would change',
    post({ headers: [['Content-Type', 'application/json']], body: { kind: 'raw', text: ' {"a":1} ' } }),
  ],
  ['a URL with a space and a brace', request({ url: 'https://a.example/a b{c}' })],
  ['a URL that is not ASCII', request({ url: 'https://a.example/é' })],
  ['a query that is not ASCII', request({ url: 'https://a.example/?q=ü' })],
  ['user:password@ in the URL', request({ url: 'https://u:p@a.example/' })],
  ['an ftp:// URL', request({ url: 'ftp://a.example/f' })],
  ['-m 3 (whole seconds)', request({ timeoutSeconds: 3 })],
];
