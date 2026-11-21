/** The history line on a tool's page says what is true: for a tool that keeps secrets only, never that its work is kept. */
import { ToolHistoryPanel } from './ToolHistoryPanel';
import { memoryHistoryHost } from '@src/history/behaviors';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryDeclaration } from '@workspace/tools-shared/history';

afterEach(cleanup);

const declaration = (secret: boolean[]): HistoryDeclaration => ({
  kinds: secret.map((s, i) => ({ id: `k${i}`, title: `Kind ${i}`, ...(s ? { secret: true } : {}) })),
  schema: 1,
  records: 'test',
  never: 'test',
});

const line = async (secret: boolean[], unlock = false) => {
  const tools = [{ id: 'probe', title: 'Probe', history: declaration(secret) }];
  const host = memoryHistoryHost(tools);
  if (unlock) await host.vault.setPassword('a long enough master password');
  const source = host.sources.find(s => s.owner === 'probe')!;
  render(<ToolHistoryPanel host={host} source={source} onOpen={() => undefined} />);
  return (await screen.findByRole('status')).textContent ?? '';
};

describe('the history line on a tool’s page', () => {
  it('a tool with open kinds: its work is kept', async () => {
    expect(await line([false])).toContain('History is on: this tool’s work is kept in this browser.');
  });

  it('open and secret kinds: kept, and the secrets not without a master password', async () => {
    expect(await line([false, true])).toMatch(
      /work is kept in this browser\. Secrets are not kept \(no master password\)/,
    );
  });

  it('secret kinds only, no master password: nothing is kept — the line does not say the work is kept', async () => {
    const text = await line([true]);
    expect(text).toContain('keeps secrets only: nothing is kept without a master password');
    expect(text).not.toMatch(/work is kept/);
  });

  it('secret kinds only, unlocked: kept, encrypted', async () => {
    expect(await line([true], true)).toContain('this tool’s work is kept in this browser, encrypted');
  }, 20_000);
});
