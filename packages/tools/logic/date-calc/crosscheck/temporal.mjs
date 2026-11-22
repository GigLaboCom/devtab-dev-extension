// Expected answers from a second independent implementation: Temporal in Chrome for Testing (docs/tools/specs/date-calc.md
// §10). Run by hand, from the repository root, after `pnpm e2e:setup` (Playwright and the browser under .state/):
//
//   node packages/tools/logic/date-calc/crosscheck/temporal.mjs [seed] [count]
//
// It opens a blank page in headless Chrome, generates seeded cases there and answers them with Temporal.ZonedDateTime —
// add / subtract (overflow 'constrain', disambiguation 'compatible') and until (largestUnit 'years' and 'days') — and
// writes .state/date-calc/temporal.json with the browser's version and every zone's offset at 00:00 UTC on the 1st of
// every month 1900–2100 (to tell where Chrome's zone data differs from Node's). src/crosscheck.test.ts compares the
// tool's logic with it when DATE_CALC_CROSSCHECK=1. Nothing here is part of the tool or of the normal tests.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const seed = Number(process.argv[2] ?? 39);
const count = Number(process.argv[3] ?? 2000);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '.state/extension-e2e/browsers');
const { chromium } = await import(pathToFileURL(join(ROOT, '.state/e2e/node/node_modules/playwright/index.mjs')).href);

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    ({ seed, count }) => {
      let a = seed >>> 0;
      const random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
      const pick = list => list[int(0, list.length - 1)];
      const all = Intl.supportedValuesOf('timeZone');
      const interesting = [
        'Europe/Berlin',
        'America/New_York',
        'America/Sao_Paulo',
        'America/Santiago',
        'Australia/Lord_Howe',
        'Australia/Sydney',
        'Pacific/Chatham',
        'Pacific/Apia',
        'Asia/Kathmandu',
        'Asia/Kolkata',
        'Africa/Casablanca',
        'Europe/Dublin',
        'America/Asuncion',
        'Europe/Moscow',
        'America/Havana',
        'Asia/Tehran',
        'UTC',
      ];
      const zone = () => (random() < 0.5 ? pick(interesting) : pick(all));
      const wall = () => {
        const year = random() < 0.8 ? int(1950, 2050) : int(1800, 2400);
        // Near the usual changes: Sundays of March, April, October and November around 00:00–04:00.
        if (random() < 0.4) {
          const month = pick([3, 4, 9, 10, 11]);
          return { year, month, day: int(1, 28), hour: int(0, 4), minute: pick([0, 15, 30, 45]) };
        }
        return { year, month: int(1, 12), day: int(1, 31), hour: int(0, 23), minute: int(0, 59) };
      };
      const zoned = (w, z) =>
        Temporal.PlainDateTime.from(
          { ...w, millisecond: random() < 0.2 ? int(0, 999) : 0 },
          { overflow: 'constrain' },
        ).toZonedDateTime(z, { disambiguation: 'compatible' });
      const fields = () => {
        const d = {};
        const calendarOnly = random() < 0.4;
        if (random() < 0.4) d.years = int(0, 5);
        if (random() < 0.6) d.months = int(0, 40);
        if (random() < 0.3) d.weeks = int(0, 10);
        if (random() < 0.6) d.days = int(0, 400);
        if (!calendarOnly) {
          if (random() < 0.5) d.hours = int(0, 72);
          if (random() < 0.4) d.minutes = int(0, 200);
          if (random() < 0.3) d.seconds = int(0, 100);
          if (random() < 0.2) d.milliseconds = int(0, 999);
        }
        if (Object.keys(d).length === 0) d.days = 1;
        return d;
      };
      const parts = d => ({
        years: d.years,
        months: d.months,
        days: d.days,
        hours: d.hours,
        minutes: d.minutes,
        seconds: d.seconds,
        milliseconds: d.milliseconds,
      });
      const cases = [];
      for (let i = 0; i < count; i++) {
        const z = zone();
        try {
          const start = zoned(wall(), z);
          if (i % 2 === 0) {
            const d = fields();
            const negative = random() < 0.3;
            const op = random() < 0.3 ? 'subtract' : 'add';
            const duration = Temporal.Duration.from(
              negative ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, -v])) : d,
            );
            const end = op === 'add' ? start.add(duration) : start.subtract(duration);
            cases.push({
              kind: 'add',
              zone: z,
              start: start.epochMilliseconds,
              fields: d,
              negative,
              op,
              expected: end.epochMilliseconds,
              offsets: [start.offsetNanoseconds / 1e6, end.offsetNanoseconds / 1e6],
            });
          } else {
            const end =
              random() < 0.5
                ? zoned(wall(), z)
                : Temporal.Instant.fromEpochMilliseconds(
                    start.epochMilliseconds + int(-5 * 366, 5 * 366) * 86_400_000 + int(-86_400_000, 86_400_000),
                  ).toZonedDateTimeISO(z);
            cases.push({
              kind: 'until',
              zone: z,
              start: start.epochMilliseconds,
              end: end.epochMilliseconds,
              years: parts(start.until(end, { largestUnit: 'years' })),
              days: parts(start.until(end, { largestUnit: 'days' })),
              offsets: [start.offsetNanoseconds / 1e6, end.offsetNanoseconds / 1e6],
            });
          }
        } catch (error) {
          cases.push({ kind: 'error', zone: z, message: String(error) });
        }
      }
      const instants = [];
      for (let y = 1900; y <= 2100; y++) for (let m = 1; m <= 12; m++) instants.push(Date.UTC(y, m - 1, 1));
      const offsets = {};
      for (const z of [...all, 'UTC'])
        offsets[z] = instants.map(
          t => Temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(z).offsetNanoseconds / 1e9,
        );
      return { userAgent: navigator.userAgent, zones: all.length, cases, instants, offsets };
    },
    { seed, count },
  );
  const out = join(ROOT, '.state/date-calc/temporal.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ seed, ...result }));
  console.log(`${result.cases.length} cases from ${result.userAgent} → ${out}`);
} finally {
  await browser.close();
}
