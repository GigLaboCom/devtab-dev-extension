#!/usr/bin/env node
// DEVTAB_MOCK_BACKEND — development only; never production.
//
// `pnpm mock:backend [options]` — a local mock of the licence and plans server, on 127.0.0.1 only, so the extension's
// licence and plans client can be built and tested before the real backend exists. `--help` lists the options;
// the developer documents' dev-mock-backend.md describes the endpoints, the scenarios and the control address.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadOrCreateKeys, publicEntries } from './keys.mjs';
import { FAULTS, LICENCE_SCENARIOS, PLANS_SCENARIOS } from './scenarios.mjs';
import { CONTROL, DEFAULT_PORT, DEFAULT_SETTINGS, settingsProblems, startMockBackend } from './server.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
export const DEFAULT_STATE_DIR = join(ROOT, '.state', 'mock-backend');

/** The environment variable that says production, if any: the mock refuses to start then. */
export function productionVariable(env) {
  for (const name of ['NODE_ENV', 'DEVTAB_ENV', 'APP_ENV', 'ENVIRONMENT', 'ENV'])
    if (/^prod(uction)?$/i.test(env[name] ?? '')) return name;
  return undefined;
}

/** Seconds from `3d`, `-40d`, `5h`, `90m`, `30s` or a plain number of seconds; NaN otherwise. */
export function parseDuration(text) {
  const m = /^([+-]?\d+)([dhms]?)$/.exec(String(text).trim());
  if (!m) return NaN;
  return Number(m[1]) * { d: 86_400, h: 3_600, m: 60, s: 1, '': 1 }[m[2]];
}

const HELP = `Usage: pnpm mock:backend [options]

A mock of the licence and plans server for development, on http://127.0.0.1 only.

  --port <n>               port (default ${DEFAULT_PORT}; 0 picks a free one)
  --scenario <name>        a licence scenario for every request, whatever the key (default: by the key)
  --fault <name>           a fault on every request: ${FAULTS.map(f => f.name).join(', ')}
  --fault-on <list>        endpoints the fault applies to (default: plans,activate,refresh,deactivate)
  --plans <name>           the plans scenario (default three)
  --delay <ms>             the slow fault's delay (default ${DEFAULT_SETTINGS.delayMs})
  --clock-offset <time>    shift the clock of what it signs: 3d, -40d, 5h, 90m or seconds
  --seats <n>              installations per licence (default ${DEFAULT_SETTINGS.seats})
  --retry-after <s>        Retry-After of rate-limited answers (default ${DEFAULT_SETTINGS.retryAfter})
  --signing-key <p1|p2>    the key that signs (default p1; p2 is the standby key)
  --max-age <s>            replace the plans' maxAge
  --extension-origin <o>   allow only this chrome-extension:// origin (repeatable; default any)
  --state-dir <dir>        where its keys live (default .state/mock-backend)
  --list                   print the scenarios and the fake licence keys, then exit
  --quiet                  no line per request
  --help                   this text

Control while it runs: GET ${CONTROL}/, GET ${CONTROL}/scenarios, GET ${CONTROL}/public-keys,
POST ${CONTROL}/settings (JSON, any of the settings above), POST ${CONTROL}/reset. Stop with Ctrl+C.`;

function listScenarios() {
  const rows = [];
  rows.push('Licence scenarios (the key opens it; any other well-formed key is unknown):');
  for (const s of LICENCE_SCENARIOS) rows.push(`  ${s.name.padEnd(30)} ${s.key}  ${s.summary}`);
  rows.push('', 'Faults:');
  for (const f of FAULTS) rows.push(`  ${f.name.padEnd(30)} ${f.summary}`);
  rows.push('', 'Plans scenarios:');
  for (const p of PLANS_SCENARIOS) rows.push(`  ${p.name.padEnd(30)} ${p.summary}`);
  return rows.join('\n');
}

/** The settings from the command line, or throws with the problems. */
export function settingsFromArgs(values) {
  const settings = {};
  const int = (flag, field, parse = Number) => {
    if (values[flag] !== undefined) settings[field] = parse(values[flag]);
  };
  if (values.scenario !== undefined) settings.licence = values.scenario;
  if (values.fault !== undefined) settings.fault = values.fault;
  if (values['fault-on'] !== undefined)
    settings.faultOn = values['fault-on']
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  if (values.plans !== undefined) settings.plans = values.plans;
  int('delay', 'delayMs');
  int('clock-offset', 'clockOffset', parseDuration);
  int('seats', 'seats');
  int('retry-after', 'retryAfter');
  int('max-age', 'maxAge');
  if (values['signing-key'] !== undefined) settings.signingKey = values['signing-key'];
  if (values['extension-origin'] !== undefined) settings.extensionOrigins = values['extension-origin'];
  const problems = settingsProblems(settings);
  if (problems.length) throw new Error(problems.join('\n'));
  return settings;
}

async function main(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      scenario: { type: 'string' },
      fault: { type: 'string' },
      'fault-on': { type: 'string' },
      plans: { type: 'string' },
      delay: { type: 'string' },
      'clock-offset': { type: 'string' },
      seats: { type: 'string' },
      'retry-after': { type: 'string' },
      'signing-key': { type: 'string' },
      'max-age': { type: 'string' },
      'extension-origin': { type: 'string', multiple: true },
      'state-dir': { type: 'string' },
      list: { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: true,
  });
  if (values.help) return void console.log(HELP);
  if (values.list) return void console.log(listScenarios());
  const production = productionVariable(env);
  if (production) {
    console.error(
      `mock backend: refusing to start — ${production}=${env[production]} says production. It is for development only.`,
    );
    process.exitCode = 2;
    return;
  }
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port: not a port: ${values.port}`);
  const settings = settingsFromArgs(values);
  const stateDir = values['state-dir'] ?? DEFAULT_STATE_DIR;
  const keys = await loadOrCreateKeys(stateDir);
  const mock = await startMockBackend({
    keys,
    port,
    settings,
    log: values.quiet ? () => {} : line => console.log(line),
  });
  const s = mock.settings();
  console.log(
    [
      'Mock licence and plans server — development only, never production',
      `  listening    ${mock.url}  (loopback only)`,
      `  keys         ${keys.created ? 'generated now in' : 'loaded from'} ${keys.file}`,
      `  signing      ${keys.signing[s.signingKey].kid} (${s.signingKey}); standby: ${keys.signing[s.signingKey === 'p1' ? 'p2' : 'p1'].kid}`,
      `  public keys  ${JSON.stringify(publicEntries(keys))}`,
      `               also at ${mock.url}${CONTROL}/public-keys and in ${keys.publicFile}`,
      `  licence      ${s.licence ? `every request: ${s.licence}` : 'by the key (pnpm mock:backend --list)'}`,
      `  fault        ${s.fault}${s.fault === 'none' ? '' : ` on ${s.faultOn.join(',')}`}`,
      `  plans        ${s.plans}`,
      `  clock        ${s.clockOffset ? `${s.clockOffset > 0 ? '+' : ''}${s.clockOffset} s` : 'real time'}`,
      `  control      ${mock.url}${CONTROL}/`,
      'Stop with Ctrl+C.',
    ].join('\n'),
  );
  const stop = async () => {
    await mock.close();
    console.log('Mock backend stopped; its state is gone.');
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch(error => {
    console.error(`mock backend: ${error.message}`);
    process.exitCode = 1;
  });
}
