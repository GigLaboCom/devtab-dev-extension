/**
 * What cURL to Code remembers between uses (D21; docs/tools/settings.md): the client the code is written for, one of
 * the seventeen — never the command or the code (secret kinds of the history, D17).
 */
import { DEFAULT_TARGET, TARGETS } from '@workspace/tool-logic-curl-to-code';
import { declareSettings, setting } from '@workspace/tools-host';

export const curlToCodeSettings = declareSettings({
  schema: 1,
  fields: {
    target: setting.oneOf(
      TARGETS.map(t => t.value),
      DEFAULT_TARGET,
    ),
  },
});
