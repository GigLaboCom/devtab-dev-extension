#!/usr/bin/env node
// A fake Native Messaging host for the Projects e2e (scripts/e2e-projects.mjs): Chrome starts it in place of the
// companion's relay, it speaks Chrome's frames on stdin / stdout (a 32-bit length in the machine's byte order, then
// UTF-8 JSON) and answers as the companion would — the scripted companion of ./companion.mjs, seeded from the
// contract's vectors (extension/src/projects/api/companion-api-v1/vectors/).
//
// Steered through a folder (DEVTAB_FAKE_HOST_DIR, set by the wrapper the e2e writes):
//   mode.json      read at start: { "mode": "normal" | "empty" | "fresh" | "version" | "not-running", "hostile", "big",
//                  "methods": "all" | "stage3" | "stage6", "confirm", "identity", "contentFlag", "limits",
//                  "openFiles" }
//                  (./companion.mjs)
//   cmd-<n>.json   commands, taken once by the running host: { "event": { name, project, data } },
//                  { "addFile": { project, path, text } }, { "changeOnDisk": { project, path, text } },
//                  { "failNext": { method, code, data, stream, hang } }, { "confirm": answer }, { "identity": … },
//                  { "gap": { project, from, to, paths } } (the companion was not running: `history.gap`),
//                  { "openFile": { …file, "emit": true|false } } (a file opened from the system; `emit` sends
//                  `open.requested` if the page told `page.activity`), { "changeOpenedOnDisk": { file, text } },
//                  { "replaceOpened": { file } }, { "openedPoint": { file, label, text, content } } (a copy in an
//                  opened file's history), { "expireTokens": true },
//                  { "exit": true } (the port is lost without a word)
//   log.jsonl      what happened: start (with the caller's origin), each frame in (type, id, method; the parameters of a
//                  commit, a rollback, a save — a text by its length — and of adding a project; `install` of a `hello`),
//                  stdin's end, exit
// Nothing else is read or written; the host never touches the network.
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompanion } from './companion.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.DEVTAB_FAKE_HOST_DIR;
if (!DIR) process.exit(2);
const VECTORS = resolve(HERE, '../../extension/src/projects/api/companion-api-v1/vectors');

const log = record =>
  appendFileSync(join(DIR, 'log.jsonl'), `${JSON.stringify({ at: Date.now(), pid: process.pid, ...record })}\n`);
const options = existsSync(join(DIR, 'mode.json')) ? JSON.parse(readFileSync(join(DIR, 'mode.json'), 'utf8')) : {};
const vectors = Object.fromEntries(
  readdirSync(VECTORS)
    .filter(f => f.endsWith('.json'))
    .map(f => [f, JSON.parse(readFileSync(join(VECTORS, f), 'utf8'))]),
);
const companion = createCompanion({ vectors, ...options });
log({ event: 'start', origin: process.argv.slice(2).find(a => a.startsWith('chrome-extension://')) ?? null, options });

const send = frame => {
  const body = Buffer.from(JSON.stringify(frame), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]));
  if (frame.type === 'chunk') log({ event: 'out', type: 'chunk', id: frame.id, seq: frame.seq, bytes: body.length });
};
const quit = code => {
  log({ event: 'exit', code });
  process.stdout.write('', () => process.exit(code));
};

let buffer = Buffer.alloc(0);
process.stdin.on('data', data => {
  buffer = Buffer.concat([buffer, data]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    let frame;
    try {
      frame = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
    } catch {
      frame = null;
    }
    buffer = buffer.subarray(4 + length);
    // What a commit, a rollback and a save were asked: the e2e checks the selection and the paths sent.
    const asked = [
      'git.commit',
      'git.rollback',
      'file.save',
      'project.requestAdd',
      'file.read',
      'history.restore',
      'history.project',
      'openFile.claim',
      'openFile.save',
      'openFile.restore',
      'page.activity',
    ].includes(frame?.method)
      ? { params: { ...frame.params, ...(frame.params?.text !== undefined && { text: frame.params.text.length }) } }
      : {};
    // The installation's number a `hello` said (step O3): the e2e checks it is made once and kept.
    const said = frame?.type === 'hello' ? { install: frame.install ?? null } : {};
    log({ event: 'in', type: frame?.type, id: frame?.id, method: frame?.method, ...asked, ...said });
    void companion.handle(frame, send).then(() => {
      // As the relay does: after its last word about the connection it exits.
      if (frame?.type === 'hello' && options.mode !== undefined && ['not-running', 'version'].includes(options.mode))
        quit(1);
    });
  }
});
process.stdin.on('end', () => {
  log({ event: 'stdin-end' });
  quit(0);
});

// The e2e's commands.
setInterval(() => {
  for (const name of readdirSync(DIR)
    .filter(f => /^cmd-\d+\.json$/.test(f))
    .sort()) {
    const file = join(DIR, name);
    try {
      renameSync(file, `${file}.taken-${process.pid}`);
    } catch {
      continue;
    }
    const command = JSON.parse(readFileSync(`${file}.taken-${process.pid}`, 'utf8'));
    log({ event: 'command', command: Object.keys(command) });
    if (command.addFile) companion.addFile(command.addFile.project, command.addFile.path, command.addFile.text);
    if (command.changeOnDisk)
      companion.changeOnDisk(command.changeOnDisk.project, command.changeOnDisk.path, command.changeOnDisk.text);
    if (command.failNext) {
      const { method, code, data, ...rest } = command.failNext;
      companion.failNext(method, code, data, rest);
    }
    if (command.confirm) companion.setConfirm(command.confirm);
    if ('identity' in command) companion.setIdentity(command.identity);
    if (command.gap) companion.gap(command.gap.project, command.gap.from, command.gap.to, command.gap.paths);
    if (command.openFile) {
      const { emit, ...spec } = command.openFile;
      const { token } = companion.offerFile(spec);
      if (emit)
        log({ event: 'emit', name: 'open.requested', sent: companion.emit('open.requested', null, { token }, send) });
    }
    if (command.changeOpenedOnDisk)
      companion.changeOpenedOnDisk(command.changeOpenedOnDisk.file, command.changeOpenedOnDisk.text);
    if (command.replaceOpened) companion.replaceOpened(command.replaceOpened.file);
    if (command.openedPoint) {
      const { file, ...spec } = command.openedPoint;
      companion.openedPoint(file, spec);
    }
    if (command.expireTokens) companion.expireTokens();
    if (command.event) {
      const { name: event, project, data } = command.event;
      log({ event: 'emit', name: event, sent: companion.emit(event, project, data, send) });
    }
    if (command.exit) quit(1);
  }
}, 50);
