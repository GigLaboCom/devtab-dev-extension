/**
 * The Text Diff tool (docs/tools/specs/text-diff.md). It has no page of its own: opened, it asks the host to go to
 * «Compare code» in place of the tool's own address (§2, §4), so Back returns to where the person was before. Until the
 * host has gone the body stays empty (§5.2). A host that cannot go there — no host at all, or one without a comparison
 * — gets a line saying where the tool leads and that it is not here. It hands nothing over and records nothing: the
 * texts are brought to «Compare code» itself (§3, §14 question 1).
 */
import { DESTINATION, REPLACES_ADDRESS } from '@workspace/tool-logic-text-diff';
import { navigationOf } from '@workspace/tools-host';
import { ToolEmpty } from '@workspace/ui/tool-page';
import { useEffect, useState } from 'react';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** What the page says when its host cannot open the comparison. */
export const UNAVAILABLE =
  'Text Diff opens Compare code, the side-by-side comparison of two texts. It is not available here.';

const TextDiffTool = ({ host }: ToolProps): ReactElement | null => {
  const navigation = navigationOf(host);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let live = true;
    const refuse = () => {
      if (live) setRefused(true);
    };
    void navigation.go(DESTINATION, { replace: REPLACES_ADDRESS }).then(went => went || refuse(), refuse);
    return () => {
      live = false;
    };
  }, [navigation]);

  return refused ? <ToolEmpty role="status">{UNAVAILABLE}</ToolEmpty> : null;
};

export default TextDiffTool;
