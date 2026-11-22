import { SETTINGS_RESET, ToolEmpty, ToolMessage, ToolOptions, ToolPage, ToolPane, ToolPanes } from './tool-page';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

afterEach(cleanup);

describe('the tool page frame', () => {
  it('title, summary and the host’s history line, then the body', () => {
    render(
      <ToolPage title="JSON" summary="Format JSON." history={<p>History is on</p>}>
        <ToolOptions>
          <button type="button">Format</button>
        </ToolOptions>
      </ToolPage>,
    );
    expect(screen.getByRole('heading', { name: 'JSON', level: 2 })).toBeTruthy();
    expect(screen.getByText('Format JSON.')).toBeTruthy();
    expect(screen.getByText('History is on')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Format' })).toBeTruthy();
  });

  it('panes: a label for the field, actions on the head line, columns or stacked', () => {
    const { container } = render(
      <ToolPanes layout="stacked">
        <ToolPane label="Input" htmlFor="in" actions={<button type="button">Copy</button>}>
          <textarea id="in" />
        </ToolPane>
      </ToolPanes>,
    );
    expect(screen.getByLabelText('Input').tagName).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).dataset.layout).toBe('stacked');
  });

  it('an error is an alert, a note a status; an empty message keeps its line', () => {
    render(
      <>
        <ToolMessage tone="error">Line 1, column 2: trailing comma</ToolMessage>
        <ToolMessage>Valid</ToolMessage>
        <ToolMessage tone="success" />
        <ToolEmpty>Paste JSON to start.</ToolEmpty>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Line 1, column 2: trailing comma');
    const [note, success] = screen.getAllByRole('status');
    expect(note!.dataset.tone).toBe('note');
    expect(success!.textContent).toBe(' ');
    expect(screen.getByText('Paste JSON to start.')).toBeTruthy();
  });

  it('no reset control unless the host passes one', () => {
    render(<ToolPage title="JSON" />);
    expect(screen.queryByRole('button', { name: 'Reset settings' })).toBeNull();
    expect(document.querySelector('[data-part="reset-announcement"]')!.textContent).toBe('');
  });

  it('Reset settings: on the title’s line while offered; pressing it resets, says so once and moves the focus to the title', () => {
    let resets = 0;
    const Host = (): ReactElement => {
      const [changed, setChanged] = useState(true);
      return (
        <ToolPage
          title="JSON"
          summary="Format JSON."
          onResetSettings={
            changed
              ? () => {
                  resets++;
                  setChanged(false);
                }
              : undefined
          }>
          <button type="button" onClick={() => setChanged(true)}>
            Change
          </button>
        </ToolPage>
      );
    };
    render(<Host />);
    const line = document.querySelector('.kit-tool-page-title-line')!;
    const reset = screen.getByRole('button', { name: 'Reset settings' });
    expect(line.contains(reset)).toBe(true);
    reset.focus();
    fireEvent.click(reset);
    expect(resets).toBe(1);
    expect(screen.queryByRole('button', { name: 'Reset settings' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'JSON' }));
    const said = document.querySelector('[data-part="reset-announcement"]')!;
    expect(said.getAttribute('role')).toBe('status');
    expect(said.textContent).toBe(SETTINGS_RESET);
    // Offered again: the announcement is cleared, so the next reset is read out again.
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(said.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    expect(resets).toBe(2);
    expect(said.textContent).toBe(SETTINGS_RESET);
  });
});
