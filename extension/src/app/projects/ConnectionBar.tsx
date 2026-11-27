/**
 * The connection part (§8.4, §8.5): how the section stands with the companion and what can be done about it — connect
 * (asks Chrome for the permission, from this click only), check again, the command that explains a stopped companion,
 * which side to update. Nothing is shown once the companion is connected but its version. What Chrome or the companion
 * said is shown as text, never thrown.
 */
import { TEXT, printable } from './text';
import { Button } from '@workspace/ui/button';
import { useEffect, useState } from 'react';
import type { ConnectionStatus, ProjectBackend } from '@src/projects/backend';
import type { ReactElement } from 'react';

export interface ConnectionBarProps {
  backend: ProjectBackend;
  status: ConnectionStatus;
}

/** Seconds until the next automatic try, counted down while `not-running`. */
const useSecondsTo = (at: number | undefined): number | null => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [at]);
  return at === undefined ? null : Math.max(0, Math.ceil((at - now) / 1000));
};

export const ConnectionBar = ({ backend, status }: ConnectionBarProps): ReactElement | null => {
  const [asked, setAsked] = useState<'asking' | 'denied' | null>(null);
  const seconds = useSecondsTo(status.state === 'not-running' ? status.retryAt : undefined);

  const connect = (): void => {
    setAsked('asking');
    // Straight from the click: Chrome takes a permission request only inside the user's gesture.
    void backend.requestPermission().then(granted => setAsked(granted ? null : 'denied'));
  };

  const checkAgain = (
    <Button size="sm" variant="outline" disabled={status.connecting} onClick={() => backend.retry()}>
      {TEXT.checkAgain}
    </Button>
  );
  const detail = status.detail ? (
    <span className="kit-projects-part-hint">{TEXT.said(printable(status.detail))}</span>
  ) : null;

  let body: ReactElement | null = null;
  switch (status.state) {
    case 'no-permission':
      body = (
        <>
          <Button size="sm" disabled={asked === 'asking' || status.connecting} onClick={connect}>
            {TEXT.connect}
          </Button>
          {asked === 'asking' && <span className="kit-projects-part-hint">{TEXT.connectAsked}</span>}
          {asked === 'denied' && <span className="kit-projects-part-hint">{TEXT.connectDenied}</span>}
        </>
      );
      break;
    case 'not-installed':
      body = (
        <>
          <span>{TEXT.notInstalled}</span>
          {detail}
          {checkAgain}
        </>
      );
      break;
    case 'not-running':
      body = (
        <>
          <span>{TEXT.notRunning}</span>
          <code className="kit-projects-command">{TEXT.notRunningCommand}</code>
          {seconds !== null && <span className="kit-projects-part-hint">{TEXT.retryIn(seconds)}</span>}
          {detail}
          {checkAgain}
        </>
      );
      break;
    case 'version-mismatch':
      body = (
        <>
          <span>{status.update === 'extension' ? TEXT.updateExtension : TEXT.updateCompanion}</span>
          {detail}
          {checkAgain}
        </>
      );
      break;
    case 'reconnecting':
      body = <span>{TEXT.reconnecting}</span>;
      break;
    case 'ready-empty':
      body = (
        <>
          {status.companion && <span className="kit-projects-part-hint">{TEXT.connected(status.companion)}</span>}
          {checkAgain}
        </>
      );
      break;
    default:
      body = status.companion ? (
        <span className="kit-projects-part-hint">{TEXT.connected(status.companion)}</span>
      ) : null;
  }
  return (
    <div
      className="kit-projects-connection"
      role="group"
      aria-label={TEXT.connectionLabel}
      data-state={status.state}
      data-connecting={status.connecting ? '' : undefined}>
      {status.connecting && status.state !== 'reconnecting' && (
        <span className="kit-projects-part-hint">{TEXT.connecting}</span>
      )}
      {body}
    </div>
  );
};
