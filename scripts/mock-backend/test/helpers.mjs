// Helpers of the mock backend's tests: a running mock with keys made in memory, and plain HTTP requests (node:http,
// so every header — Host, Origin — is under the test's control).
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { generateKeys } from '../keys.mjs';
import { startMockBackend } from '../server.mjs';

/** A random installation number: 16 bytes in base64url, as the extension makes it. */
export const newInst = () => randomBytes(16).toString('base64url');

/** A mock on a free port with fresh keys and a clock the test can move (`clock.ms`). */
export async function mock(settings = {}) {
  const keys = await generateKeys();
  const clock = { ms: Date.UTC(2026, 10, 23, 12, 0, 0) };
  const lines = [];
  const server = await startMockBackend({
    keys,
    port: 0,
    settings,
    now: () => clock.ms,
    log: line => lines.push(line),
  });
  return { ...server, keys, clock, lines };
}

/**
 * One request. `body`: an object (sent as JSON with Content-Type: application/json) or a string sent as is.
 * Resolves `{ status, headers, text, json }`; rejects on a network error (a dropped connection). `timeoutMs` aborts.
 */
export function request(base, { method = 'GET', path = '/', headers = {}, body, timeoutMs = 5000 } = {}) {
  const url = new URL(path, base);
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const allHeaders = {
    host: url.host,
    ...(payload !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
    ...(payload !== undefined ? { 'content-length': Buffer.byteLength(payload) } : {}),
    ...headers,
  };
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: allHeaders,
        timeout: timeoutMs,
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export const post = (base, path, body, headers = {}) => request(base, { method: 'POST', path, body, headers });

/** Activates `key` for a new (or the given) installation; returns the answer and the installation. */
export async function activate(base, key, inst = newInst()) {
  const answer = await post(base, '/v1/activate', { key, inst });
  return { ...answer, inst };
}
