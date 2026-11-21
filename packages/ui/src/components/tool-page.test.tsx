import { ToolEmpty, ToolMessage, ToolOptions, ToolPage, ToolPane, ToolPanes } from './tool-page';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
});
