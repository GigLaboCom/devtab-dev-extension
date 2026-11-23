// DEVTAB_MOCK_BACKEND — development only.
//
// The mock licence and plans server: every endpoint of the contract (contract.mjs) on 127.0.0.1, answering by
// scenario (scenarios.mjs), with state in memory only. A control address outside the contract, /__mock/…, switches
// scenarios without a restart. It is not a security model and keeps nothing.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  ACTIVATION_CHURN,
  CHURN_PERIOD,
  ENDPOINTS,
  ERROR_MESSAGES,
  ERRORS,
  EXTENSION_ORIGIN,
  LIMITS,
  PLANS_CACHE_CONTROL,
  PLANS_CORS_HEADERS,
  PLANS_PREFLIGHT_HEADERS,
  canonicalKey,
  endpointAt,
  issueClaims,
  licenceCorsHeaders,
  requestProblems,
} from './contract.mjs';
import { breakSignature, signToken } from './jws.mjs';
import { ROLES, publicEntries } from './keys.mjs';
import { FAULTS, LICENCE_SCENARIOS, PLANS_SCENARIOS, licenceScenario, plansScenario } from './scenarios.mjs';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 8790;
export const CONTROL = '/__mock';

export const DEFAULT_SETTINGS = Object.freeze({
  /** A licence scenario for every request, whatever the key; null: chosen by the key. */
  licence: null,
  fault: 'none',
  /** The endpoints a fault applies to. */
  faultOn: Object.freeze(Object.keys(ENDPOINTS)),
  plans: 'three',
  /** The `slow` fault's delay, ms. */
  delayMs: 3000,
  /** Seconds added to the mock's clock for everything it signs: positive — tokens from the future. */
  clockOffset: 0,
  seats: 3,
  /** Retry-After of rate-limited answers, seconds. */
  retryAfter: 120,
  /** The key that signs: p1, or the standby p2. */
  signingKey: 'p1',
  /** Replaces the plans' maxAge when a number. */
  maxAge: null,
  /** Origins the licence endpoints allow; empty: any chrome-extension:// origin. */
  extensionOrigins: Object.freeze([]),
});

const names = list => list.map(s => s.name);

/** Problems with a partial settings object (control body or command line). */
export function settingsProblems(partial) {
  if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) return ['not a JSON object'];
  const problems = [];
  const oneOf = (field, allowed) => {
    if (!allowed.includes(partial[field])) problems.push(`${field} must be one of ${allowed.join(', ')}`);
  };
  const count = (field, min, max) => {
    const v = partial[field];
    if (!(Number.isInteger(v) && v >= min && v <= max))
      problems.push(`${field} must be an integer within ${min}…${max}`);
  };
  for (const field of Object.keys(partial)) {
    if (!(field in DEFAULT_SETTINGS)) problems.push(`unknown setting ${field}`);
    else if (field === 'licence') oneOf(field, [null, ...names(LICENCE_SCENARIOS)]);
    else if (field === 'fault') oneOf(field, names(FAULTS));
    else if (field === 'plans') oneOf(field, names(PLANS_SCENARIOS));
    else if (field === 'signingKey') oneOf(field, ROLES);
    else if (field === 'delayMs') count(field, 0, 600_000);
    else if (field === 'clockOffset') count(field, -3650 * 86_400, 3650 * 86_400);
    else if (field === 'seats') count(field, 1, 100);
    else if (field === 'retryAfter') count(field, 0, 7 * 86_400);
    else if (field === 'maxAge') {
      if (!(partial.maxAge === null || Number.isInteger(partial.maxAge)))
        problems.push('maxAge must be an integer or null');
    } else if (field === 'faultOn') {
      const ok = Array.isArray(partial.faultOn) && partial.faultOn.every(e => e in ENDPOINTS);
      if (!ok) problems.push(`faultOn must be a list of ${Object.keys(ENDPOINTS).join(', ')}`);
    } else if (field === 'extensionOrigins') {
      const ok =
        Array.isArray(partial.extensionOrigins) && partial.extensionOrigins.every(o => EXTENSION_ORIGIN.test(o));
      if (!ok) problems.push('extensionOrigins must be a list of chrome-extension://<32 letters a–p>');
    }
  }
  return problems;
}

const json = value => JSON.stringify(value);
const randomId = bytes => randomBytes(bytes).toString('base64url');

/**
 * Starts the mock. `keys`: from keys.mjs. `now`: the real clock in ms (tests move it). `log`: one line per request.
 * Resolves `{ url, port, settings(), state, close() }` once listening.
 */
export async function startMockBackend({ keys, port = DEFAULT_PORT, settings = {}, now = Date.now, log = () => {} }) {
  const problems = settingsProblems(settings);
  if (problems.length) throw new Error(`settings: ${problems.join('; ')}`);
  const start = { ...DEFAULT_SETTINGS, ...settings };
  let current = { ...start };
  /** lid → licence; canonical key → lid. */
  const licences = new Map();
  const byKey = new Map();
  const timers = new Set();

  const seconds = () => Math.floor(now() / 1000) + current.clockOffset;

  function reset() {
    licences.clear();
    byKey.clear();
    current = { ...start };
  }

  // -- answers ---------------------------------------------------------------------------------------------------------

  function allowedOrigin(origin) {
    if (!origin) return undefined;
    if (current.extensionOrigins.length) return current.extensionOrigins.includes(origin) ? origin : undefined;
    return EXTENSION_ORIGIN.test(origin) ? origin : undefined;
  }

  function corsFor(endpoint, req) {
    if (!endpoint) return {};
    return endpoint === 'plans' ? { ...PLANS_CORS_HEADERS } : licenceCorsHeaders(allowedOrigin(req.headers.origin));
  }

  /** An error answer; rate-limited always carries Retry-After, unavailable only when `retry` says so (§5.1). */
  const errorAnswer = (code, extra = {}, { retry = code === 'rate-limited' } = {}) => ({
    status: ERRORS[code],
    body: { error: code, message: ERROR_MESSAGES[code] },
    headers: retry ? { 'retry-after': String(current.retryAfter) } : {},
    ...extra,
  });

  // -- licences --------------------------------------------------------------------------------------------------------

  function licenceFields(spec, at) {
    return {
      status: spec.status,
      reason: spec.reason,
      term: spec.term,
      renews: spec.renews,
      paid: spec.paidIn === null || spec.paidIn === undefined ? null : at + spec.paidIn,
    };
  }

  /** Signs `spec` for (lid, inst) by the scenario and the fault; keeps the genuine token for `replay`. */
  async function tokenFor({ lid, inst, spec, scenario, installation }) {
    if (current.fault === 'replay' && installation?.tokens.length) return installation.tokens[0];
    const at = seconds();
    const claims = issueClaims({ lid, inst, iat: at - (scenario?.backdate ?? 0), licence: licenceFields(spec, at) });
    const role = scenario?.signWith ?? current.signingKey;
    const key = current.fault === 'unknown-kid' ? keys.unknown : keys.signing[role];
    const token = await signToken(claims, key);
    if (installation && current.fault !== 'unknown-kid') installation.tokens.push(token);
    return current.fault === 'bad-signature' ? breakSignature(token) : token;
  }

  function licenceFor(scenario, keyId) {
    const known = byKey.get(keyId);
    if (known) return licences.get(known);
    const at = seconds();
    const licence = {
      lid: `lic_mock_${randomId(12)}`,
      scenario: scenario.name,
      installations: new Map(),
      phantomSeats: scenario.seatsTaken ? Infinity : 0,
      activations: scenario.churnUsed
        ? Array.from({ length: ACTIVATION_CHURN * current.seats }, () => at - 86_400)
        : [],
    };
    licences.set(licence.lid, licence);
    byKey.set(keyId, licence.lid);
    return licence;
  }

  async function activate(body) {
    const keyId = canonicalKey(body.key);
    const scenario = licenceScenario(current.licence) ?? (keyId && scenarioForKey(keyId));
    if (!scenario) return errorAnswer('key-unknown', { label: 'licence=key-unknown' });
    const label = `licence=${current.licence ? 'override:' : ''}${scenario.name}`;
    if (scenario.error) return errorAnswer(scenario.error, { label });
    if (scenario.activation) return errorAnswer(scenario.activation, { label });
    // An activation only ever answers an active token: a licence that would be signed ended or revoked — the
    // subscription ended, the purchase refunded, the payment's grace over — is licence-inactive (§5.2).
    const at = seconds();
    const would = issueClaims({
      lid: 'lic_mock_probe',
      inst: body.inst,
      iat: at - (scenario.backdate ?? 0),
      licence: licenceFields(scenario.grant, at),
    });
    if (would.status !== 'active') return errorAnswer('licence-inactive', { label });
    const licence = licenceFor(scenario, keyId ?? `raw:${body.key}`);
    let installation = licence.installations.get(body.inst);
    if (installation?.status !== 'active') {
      const active = [...licence.installations.values()].filter(i => i.status === 'active').length;
      const recent = licence.activations.filter(t => t > at - CHURN_PERIOD).length;
      if (active + licence.phantomSeats >= current.seats || recent >= ACTIVATION_CHURN * current.seats)
        return errorAnswer('seat-limit', { label });
      installation ??= { tokens: [] };
      installation.status = 'active';
      licence.installations.set(body.inst, installation);
      licence.activations.push(at);
    }
    installation.secret = randomId(32);
    const token = await tokenFor({ lid: licence.lid, inst: body.inst, spec: scenario.grant, scenario, installation });
    return { status: 200, body: { token, secret: installation.secret }, label };
  }

  async function refreshOrDeactivate(endpoint, body) {
    const licence = licences.get(body.lid);
    const scenario = licenceScenario(current.licence) ?? licenceScenario(licence?.scenario);
    const label = `licence=${current.licence ? 'override:' : ''}${scenario?.name ?? 'unknown-installation'}`;
    if (scenario?.error) return errorAnswer(scenario.error, { label });
    const installation = licence?.installations.get(body.inst);
    const known = installation && installation.secret === body.secret;
    const { lid, inst } = body;
    if (endpoint === 'deactivate') {
      // Always 204, for an unknown installation and a repeat too (§5.4); the seat is freed when all matches.
      if (known) installation.status = 'deactivated';
      return { status: 204, label };
    }
    if (!known) {
      const spec = { status: 'revoked', reason: 'unknown-installation', paidIn: null };
      const token = await tokenFor({ lid, inst, spec, scenario: undefined });
      return { status: 200, body: { token }, label: 'licence=unknown-installation' };
    }
    const spec =
      installation.status === 'deactivated'
        ? { status: 'revoked', reason: 'deactivated', paidIn: scenario.grant.paidIn ?? null }
        : (scenario.check ?? scenario.grant);
    return { status: 200, body: { token: await tokenFor({ lid, inst, spec, scenario, installation }) }, label };
  }

  // -- plans -----------------------------------------------------------------------------------------------------------

  function plans(req) {
    const scenario = plansScenario(current.plans);
    const label = `plans=${scenario.name}`;
    if (scenario.error) return errorAnswer(scenario.error, { label });
    const body = scenario.body(seconds());
    if (current.maxAge !== null) body.maxAge = current.maxAge;
    const text = json(body);
    const etag = `"${createHash('sha256').update(text).digest('base64url').slice(0, 22)}"`;
    const headers = { etag, 'cache-control': PLANS_CACHE_CONTROL };
    if (req.headers['if-none-match'] === etag) return { status: 304, headers, label };
    return { status: 200, text, headers, label };
  }

  // -- faults ----------------------------------------------------------------------------------------------------------

  const wait = ms =>
    new Promise(resolve => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timers.add(timer);
    });

  /** The fault's answer when it replaces the normal one; `{ hold }` for no answer, `{ drop }` to cut the connection. */
  async function faultAnswer(endpoint) {
    if (!current.faultOn.includes(endpoint)) return undefined;
    const label = `fault=${current.fault}`;
    switch (current.fault) {
      case 'drop':
        return { drop: true, label };
      case 'timeout':
        return { hold: true, label };
      case 'slow':
        await wait(current.delayMs);
        return undefined;
      case 'http-500':
        return { status: 500, body: { error: 'internal', message: 'Mock: a server error.' }, label };
      case 'http-503':
        return errorAnswer('unavailable', { label });
      case 'http-503-retry':
        return errorAnswer('unavailable', { label }, { retry: true });
      case 'portal':
        return {
          status: 200,
          text: '<!doctype html><title>Guest Wi-Fi</title><p>Accept the terms to continue.</p>',
          headers: { 'content-type': 'text/html; charset=utf-8' },
          label,
        };
      case 'redirect':
        return { status: 302, headers: { location: 'https://portal.example.invalid/login' }, label };
      case 'too-large': {
        const limit = endpoint === 'plans' ? LIMITS.plansAnswerBytes : LIMITS.licenceAnswerBytes;
        const text = json({ pad: '' });
        return { status: 200, text: json({ pad: 'x'.repeat(limit + 1 - text.length) }), label };
      }
      default:
        return undefined;
    }
  }

  // -- requests --------------------------------------------------------------------------------------------------------

  function readBody(req, limit) {
    return new Promise(resolve => {
      const chunks = [];
      let size = 0;
      let over = false;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > limit) over = true;
        else chunks.push(chunk);
      });
      req.on('end', () => resolve(over ? { over } : { text: Buffer.concat(chunks).toString('utf8') }));
      req.on('error', () => resolve({ over: false, text: '' }));
    });
  }

  function send(res, req, endpoint, answer) {
    const headers = { ...corsFor(endpoint, req), ...(answer.headers ?? {}) };
    let payload = '';
    if (answer.text !== undefined) payload = answer.text;
    else if (answer.body !== undefined) payload = json(answer.body);
    if (payload) {
      headers['content-type'] ??= 'application/json';
      if (endpoint && endpoint !== 'plans') headers['cache-control'] ??= 'no-store';
      headers['content-length'] = String(Buffer.byteLength(payload));
    } else if (endpoint && endpoint !== 'plans') headers['cache-control'] ??= 'no-store';
    res.writeHead(answer.status, headers);
    res.end(payload);
  }

  async function contract(endpoint, req) {
    const spec = ENDPOINTS[endpoint];
    if (req.method === 'OPTIONS') {
      const cors = endpoint === 'plans' ? { ...PLANS_PREFLIGHT_HEADERS } : corsFor(endpoint, req);
      return { status: 204, headers: cors, label: 'preflight' };
    }
    if (req.method !== spec.method)
      return {
        status: 405,
        headers: { allow: `${spec.method}, OPTIONS` },
        body: { error: 'method-not-allowed', message: `Use ${spec.method}.` },
        label: 'method',
      };
    const read = await readBody(req, LIMITS.requestBytes);
    if (read.over) return errorAnswer('payload-too-large', { label: 'body' });
    const replaced = await faultAnswer(endpoint);
    if (replaced) return replaced;
    if (endpoint === 'plans') return plans(req);
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    let body;
    try {
      body = type === 'application/json' ? JSON.parse(read.text) : undefined;
    } catch {
      body = undefined;
    }
    if (body === undefined || requestProblems(endpoint, body).length)
      return errorAnswer('bad-request', { label: 'body' });
    return endpoint === 'activate' ? activate(body) : refreshOrDeactivate(endpoint, body);
  }

  async function control(path, req) {
    const label = 'control';
    if (req.headers.origin)
      return {
        status: 403,
        body: { error: 'mock-control', message: 'The control address takes no browser requests.' },
        label,
      };
    const sub = path.slice(CONTROL.length).replace(/\/$/, '');
    if (req.method === 'GET' && sub === '') return { status: 200, body: overview(), label };
    if (req.method === 'GET' && sub === '/scenarios') return { status: 200, body: scenarioList(), label };
    if (req.method === 'GET' && sub === '/public-keys') return { status: 200, body: publicEntries(keys), label };
    if (req.method === 'POST' && (sub === '/settings' || sub === '/reset')) {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const read = await readBody(req, LIMITS.requestBytes);
      if (sub === '/reset') {
        reset();
        return { status: 200, body: overview(), label };
      }
      let partial;
      try {
        partial = type === 'application/json' ? JSON.parse(read.text) : undefined;
      } catch {
        partial = undefined;
      }
      const problems =
        partial === undefined ? ['send a JSON object with Content-Type: application/json'] : settingsProblems(partial);
      if (problems.length)
        return { status: 400, body: { error: 'mock-settings', message: problems.join('; ') }, label };
      current = { ...current, ...partial };
      return { status: 200, body: { settings: current }, label };
    }
    return { status: 404, body: { error: 'not-found', message: `See GET ${CONTROL}/` }, label };
  }

  function overview() {
    return {
      mock: 'development only — never production',
      settings: current,
      signing: keys.signing[current.signingKey].kid,
      publicKeys: publicEntries(keys),
      licences: [...licences.values()].map(l => ({
        lid: l.lid,
        scenario: l.scenario,
        installations: [...l.installations].map(([inst, i]) => ({ inst, status: i.status, tokens: i.tokens.length })),
      })),
      endpoints: Object.values(ENDPOINTS).map(e => `${e.method} ${e.path}`),
      control: [
        `GET ${CONTROL}/`,
        `GET ${CONTROL}/scenarios`,
        `GET ${CONTROL}/public-keys`,
        `POST ${CONTROL}/settings`,
        `POST ${CONTROL}/reset`,
      ],
    };
  }

  const describe = ({ name, summary, expect }) => ({ name, summary, expect });
  function scenarioList() {
    return {
      licence: LICENCE_SCENARIOS.map(s => ({
        ...describe(s),
        key: s.key,
        ...(s.aliases ? { aliases: s.aliases } : {}),
      })),
      faults: FAULTS.map(describe),
      plans: PLANS_SCENARIOS.map(describe),
    };
  }

  const keyIndex = new Map();
  for (const s of LICENCE_SCENARIOS) for (const k of [s.key, ...(s.aliases ?? [])]) keyIndex.set(canonicalKey(k), s);
  function scenarioForKey(keyId) {
    return keyIndex.get(keyId);
  }

  // -- the server ------------------------------------------------------------------------------------------------------

  const server = createServer(async (req, res) => {
    const began = Date.now();
    const path = new URL(req.url, 'http://mock.invalid').pathname;
    const endpoint = endpointAt(path);
    let answer;
    try {
      const actualPort = server.address().port;
      const allowedHosts = [`${HOST}:${actualPort}`, `localhost:${actualPort}`];
      if (!allowedHosts.includes(req.headers.host))
        answer = { status: 403, body: { error: 'mock-host', message: 'Use http://127.0.0.1.' }, label: 'host' };
      else if (path === CONTROL || path.startsWith(`${CONTROL}/`)) answer = await control(path, req);
      else if (endpoint) answer = await contract(endpoint, req);
      else answer = { status: 404, body: { error: 'not-found', message: 'No such address.' }, label: '-' };
    } catch (error) {
      answer = {
        status: 500,
        body: { error: 'mock-error', message: String(error?.message ?? error) },
        label: 'mock-error',
      };
    }
    const line = (status, label) =>
      `${new Date().toISOString()} ${req.method} ${path} ${label} ${status} ${Date.now() - began}ms`;
    if (answer.drop) {
      log(line('dropped', answer.label));
      req.socket.destroy();
      return;
    }
    if (answer.hold) {
      log(line('held (no answer)', answer.label));
      return;
    }
    send(res, req, endpoint, answer);
    log(line(answer.status, answer.label ?? '-'));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const actual = server.address().port;

  return {
    url: `http://${HOST}:${actual}`,
    port: actual,
    settings: () => current,
    state: { licences },
    reset,
    close: () =>
      new Promise(resolve => {
        for (const timer of timers) clearTimeout(timer);
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
