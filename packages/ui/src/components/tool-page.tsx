/**
 * The tool page frame (D14): what every tool page has in common, so the tools look like one product. The look is
 * `kit-tool-*` in @workspace/dna/style-gpui.css (any host of the tools wears it; not the extension's frame).
 *
 *   <ToolPage title summary history>     the host wraps every tool in it: title, summary, the host's history line
 *            onResetSettings>            and, when the host offers it, "Reset settings" on the title's line
 *     <ToolOptions>                      the tool's body starts here: a row of options and actions
 *     <ToolPanes>                        input and result side by side (`layout="stacked"`: one under the other)
 *       <ToolPane label="Input" htmlFor actions>…<ToolMessage tone="error">…</ToolMessage></ToolPane>
 *       <ToolPane label="Result" actions={<CopyButton …/>}>…</ToolPane>
 *     <ToolEmpty>                        what an empty tool says, if anything
 *
 * A message is words next to the field it is about: an error (`tone="error"`, read out at once — role `alert`), a note
 * or a success (role `status`). Its line keeps its height while empty, so the page does not jump while typing.
 *
 * The reset control (D21, docs/tools/settings.md): the host passes `onResetSettings` while the tool's saved parameters
 * differ from its defaults (in a host that remembers them); the page shows one "Reset settings" button at the end of the
 * title's line — the same in every tool, which writes none of it. Pressing it calls the host, says "Settings reset to
 * defaults." once to a screen reader and moves the focus to the tool's title (the button goes away with the
 * difference); Tab goes on from there into the tool.
 */
import { Button } from './button';
import { Label } from './label';
import { cn } from '../lib/utils';
import { RotateCcwIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

/** What the reset control says when it was pressed. */
export const SETTINGS_RESET = 'Settings reset to defaults.';

export interface ToolPageProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  /** One line under the title. */
  summary?: ReactNode;
  /** The host's line about what the tool keeps (its history), under the summary. */
  history?: ReactNode;
  /** The heading level of the title (the host's page has its own h1). */
  level?: 1 | 2 | 3;
  /**
   * Puts the tool's saved settings back to their defaults — passed only while they differ from them: the page then
   * shows "Reset settings". Absent: no control.
   */
  onResetSettings?: () => void;
}

export const ToolPage = ({
  title,
  summary,
  history,
  level = 2,
  onResetSettings,
  className,
  children,
  ...props
}: ToolPageProps): ReactElement => {
  const Heading = `h${level}` as const;
  const heading = useRef<HTMLHeadingElement>(null);
  const [said, setSaid] = useState('');
  // Offered again (a new difference): the next reset is read out again.
  const offered = onResetSettings !== undefined;
  useEffect(() => {
    if (offered) setSaid('');
  }, [offered]);
  return (
    <section data-slot="tool-page" className={cn('kit-tool-page', className)} {...props}>
      <header className="kit-tool-page-head">
        <div className="kit-tool-page-title-line">
          <Heading ref={heading} tabIndex={-1} className="kit-tool-page-title">
            {title}
          </Heading>
          {onResetSettings && (
            <Button
              variant="ghost"
              size="sm"
              className="kit-tool-page-reset"
              data-part="reset-settings"
              onClick={() => {
                onResetSettings();
                setSaid(SETTINGS_RESET);
                heading.current?.focus();
              }}>
              <RotateCcwIcon aria-hidden="true" />
              Reset settings
            </Button>
          )}
        </div>
        {summary && <p className="kit-tool-page-summary">{summary}</p>}
        <p className="sr-only" role="status" data-part="reset-announcement">
          {said}
        </p>
      </header>
      {history}
      {children}
    </section>
  );
};

export const ToolOptions = ({ className, ...props }: ComponentProps<'div'>): ReactElement => (
  <div data-slot="tool-options" className={cn('kit-tool-options', className)} {...props} />
);

export const ToolPanes = ({
  layout = 'columns',
  className,
  ...props
}: ComponentProps<'div'> & { layout?: 'columns' | 'stacked' }): ReactElement => (
  <div data-slot="tool-panes" data-layout={layout} className={cn('kit-tool-panes', className)} {...props} />
);

export interface ToolPaneProps extends ComponentProps<'div'> {
  /** The pane's name: a label for the field inside (`htmlFor`), or a plain name when the content is not one field. */
  label?: ReactNode;
  htmlFor?: string;
  /** Buttons on the pane's head line, right of its name (Copy, Swap). */
  actions?: ReactNode;
}

export const ToolPane = ({ label, htmlFor, actions, className, children, ...props }: ToolPaneProps): ReactElement => (
  <div data-slot="tool-pane" className={cn('kit-tool-pane', className)} {...props}>
    {(label || actions) && (
      <div className="kit-tool-pane-head">
        {htmlFor ? (
          <Label htmlFor={htmlFor}>{label}</Label>
        ) : (
          <span className="cn-label flex items-center">{label}</span>
        )}
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
    )}
    {children}
  </div>
);

export interface ToolMessageProps extends ComponentProps<'p'> {
  /** `error` is read out at once (role `alert`); `note` and `success` politely (role `status`). */
  tone?: 'error' | 'note' | 'success';
}

export const ToolMessage = ({ tone = 'note', className, children, ...props }: ToolMessageProps): ReactElement => (
  <p
    data-slot="tool-message"
    data-tone={tone}
    role={tone === 'error' ? 'alert' : 'status'}
    className={cn('kit-tool-message', className)}
    {...props}>
    {children ?? ' '}
  </p>
);

export const ToolEmpty = ({ className, ...props }: ComponentProps<'p'>): ReactElement => (
  <p data-slot="tool-empty" className={cn('kit-tool-empty', className)} {...props} />
);
