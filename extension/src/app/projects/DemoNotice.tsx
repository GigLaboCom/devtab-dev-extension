/**
 * The connection part (§8.4, §8.5): what the section is connected to. With the demo backend — the only one in this
 * version — a notice that what the page shows is an invented example, and what the companion would show instead.
 * The companion's states (not installed, not running, another version, …) come with the companion.
 */
import { TEXT } from './text';
import type { ConnectionState } from '@src/projects/backend';
import type { ReactElement } from 'react';

export interface DemoNoticeProps {
  demo: boolean;
  state: ConnectionState;
}

export const DemoNotice = ({ demo, state }: DemoNoticeProps): ReactElement | null =>
  demo ? (
    <div className="kit-projects-demo" role="note" data-state={state}>
      <span className="kit-projects-demo-badge">{TEXT.demoBadge}</span>
      <p className="kit-projects-demo-text">
        {TEXT.demoNotice} {TEXT.demoCompanion}
      </p>
    </div>
  ) : null;
