/**
 * «Live review» — a stub. The real part (D8, phase 2) reads changes from the local openidea-server through the
 * companion over Native Messaging. None of that exists yet, so this page only says so; the extension does not ask for
 * the `nativeMessaging` permission and has no code that uses it.
 */
import { routeHash } from '../route';
import { Card, CardContent, CardHeader, CardTitle } from '@src/components/ui/card';
import type { ReactElement } from 'react';

export const LiveReviewPage = (): ReactElement => (
  <section className="kit-section" aria-labelledby="review-title">
    <header className="kit-section-head">
      <div>
        <h1 id="review-title" className="kit-section-title">
          Live review
        </h1>
        <p className="kit-section-hint">Review uncommitted changes in your local repositories as they happen.</p>
      </div>
    </header>
    <Card className="max-w-160">
      <CardHeader>
        <CardTitle>
          <h2>Companion app required</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p>
          Live review reads changes from the repositories on your computer through a small companion app. The companion
          is not installed, so there is nothing to show here yet. It will be available for macOS.
        </p>
        <p>
          Without it you can still compare any two texts or files in{' '}
          <a href={routeHash({ section: 'compare' })}>Compare code</a> and use the{' '}
          <a href={routeHash({ section: 'tools' })}>Tools</a>.
        </p>
      </CardContent>
    </Card>
  </section>
);
