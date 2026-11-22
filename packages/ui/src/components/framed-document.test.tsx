import { FRAME_POLICY, FRAME_SANDBOX, FramedDocument, frameSource } from './framed-document';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom loads no srcdoc: the frame's document is the initial empty one, which is enough to see what the page puts into
// it and when; what Chrome does with the srcdoc (the sandbox, the policy) is the e2e modules' of the tools that use it.

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-mode');
});

const frame = () => screen.getByTitle('Doc') as HTMLIFrameElement;
const fill = (text: string) => (doc: Document) => {
  doc.body.textContent = text;
};

describe('FramedDocument', () => {
  it('is a srcdoc frame sandboxed without scripts, forms or top navigation', () => {
    render(<FramedDocument title="Doc" stylesheet="/assets/doc.css" render={fill('x')} version={1} />);
    const f = frame();
    expect(f.getAttribute('sandbox')).toBe(FRAME_SANDBOX);
    for (const flag of ['allow-scripts', 'allow-forms', 'allow-top-navigation', 'allow-modals', 'allow-downloads'])
      expect(FRAME_SANDBOX.split(' ')).not.toContain(flag);
    expect(f.getAttribute('src')).toBeNull();
    expect(f.getAttribute('data-slot')).toBe('framed-document');
  });

  it('its document carries the default policy and the stylesheet file, nothing inline', () => {
    render(<FramedDocument title="Doc" stylesheet="/assets/doc.css" render={fill('x')} version={1} />);
    const srcdoc = frame().getAttribute('srcdoc')!;
    expect(srcdoc).toBe(frameSource('/assets/doc.css'));
    expect(srcdoc).toBe(
      '<!doctype html><html><head><meta charset="utf-8">' +
        `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">` +
        '<link rel="stylesheet" href="/assets/doc.css"></head><body></body></html>',
    );
    expect(srcdoc).not.toMatch(/<script|<style|style=|blob:|data:/);
    for (const directive of ["default-src 'none'", "script-src 'none'", "img-src 'none'", "base-uri 'none'"])
      expect(FRAME_POLICY).toContain(directive);
  });

  it('takes a policy of its own and no stylesheet: then the document links none', () => {
    const policy = "default-src 'none'; style-src 'none'";
    render(<FramedDocument title="Doc" policy={policy} render={fill('x')} version={1} />);
    const srcdoc = frame().getAttribute('srcdoc')!;
    expect(srcdoc).toBe(frameSource(undefined, policy));
    expect(srcdoc).toContain(`content="${policy}"`);
    expect(srcdoc).not.toContain('<link');
  });

  it('escapes what it writes into attributes', () => {
    expect(frameSource('/a.css"><script>x</script>', 'a "b" <c>')).toContain(
      'content="a &quot;b&quot; &lt;c&gt;"><link rel="stylesheet" href="/a.css&quot;&gt;&lt;script&gt;x&lt;/script&gt;">',
    );
  });

  it('draws when its document is ready and again when the version changes, counting each drawing', async () => {
    const draw = vi.fn(fill('first'));
    const { rerender } = render(<FramedDocument title="Doc" render={draw} version={1} />);
    await waitFor(() => expect(frame().getAttribute('data-rendered')).toBe('1'));
    expect(frame().contentDocument!.body.textContent).toBe('first');
    rerender(<FramedDocument title="Doc" render={draw} version={1} />);
    expect(frame().getAttribute('data-rendered')).toBe('1');
    rerender(<FramedDocument title="Doc" render={fill('second')} version={2} />);
    await waitFor(() => expect(frame().getAttribute('data-rendered')).toBe('2'));
    expect(frame().contentDocument!.body.textContent).toBe('second');
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('wears the page’s theme attributes, also after a change — unless theme={false}', async () => {
    document.documentElement.setAttribute('data-theme', 'default-light');
    document.documentElement.setAttribute('data-mode', 'light');
    const { unmount } = render(<FramedDocument title="Doc" render={fill('x')} version={1} />);
    const html = () => frame().contentDocument!.documentElement;
    await waitFor(() => expect(html().getAttribute('data-theme')).toBe('default-light'));
    document.documentElement.setAttribute('data-theme', 'default-dark');
    document.documentElement.setAttribute('data-mode', 'dark');
    await waitFor(() => expect(html().getAttribute('data-mode')).toBe('dark'));
    expect(html().getAttribute('data-theme')).toBe('default-dark');
    unmount();

    render(<FramedDocument title="Doc" theme={false} render={fill('x')} version={1} />);
    await waitFor(() => expect(frame().getAttribute('data-rendered')).toBe('1'));
    document.documentElement.setAttribute('data-mode', 'light');
    await new Promise(r => setTimeout(r, 0));
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(html().hasAttribute('data-mode')).toBe(false);
  });

  it('wears the kit’s class with the caller’s, and passes other attributes on', () => {
    render(<FramedDocument title="Doc" className="h-90" data-part="preview" render={fill('x')} version={1} />);
    expect(frame().className).toBe('kit-framed-document h-90');
    expect(frame().getAttribute('data-part')).toBe('preview');
  });
});
