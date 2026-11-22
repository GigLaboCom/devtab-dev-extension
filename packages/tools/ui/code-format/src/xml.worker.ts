/*! @license ISC
saxes 6.0.0 — Copyright Louis-Dominique Dubeau and contributors; a fork of sax 1.2.4 — Copyright Isaac Z. Schlueter
and contributors.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby
granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
*/
/*! @license MIT
xmlchars 2.2.0 — Copyright Louis-Dominique Dubeau and contributors to xmlchars

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/**
 * The XML worker (docs/tools/specs/code-format.md §5 п. 9): saxes checks well-formedness and the logic's printer prints,
 * off the page's thread. XML is not Prettier's, so it is a worker of its own: saxes and the printer are bundled into this
 * file, and choosing XML loads nothing of Prettier. Loaded from its own file by `formatter.ts`; cancelling is the page
 * terminating it.
 */
import { formatXml } from '@workspace/tool-logic-code-format';
import { SaxesParser } from 'saxes';
import type { FormatJob, FormatReply } from './formatter';
import type { SaxParserClass } from '@workspace/tool-logic-code-format';

export type XmlRequest = FormatJob & { id: number };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<XmlRequest>) => void) | null;
  postMessage: (reply: FormatReply) => void;
};

scope.onmessage = ({ data }) => {
  const { id, text, settings } = data;
  try {
    const started = performance.now();
    const result = formatXml(SaxesParser as unknown as SaxParserClass, text, settings.indent);
    scope.postMessage({ id, result, ms: performance.now() - started });
  } catch (error) {
    scope.postMessage({ id, failure: error instanceof Error ? error.message : String(error) });
  }
};
