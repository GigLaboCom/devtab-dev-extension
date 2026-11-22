/**
 * The QR Code tool as a host lists it (docs/tools/specs/qr.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. No `detect` (§7): the input of Generate is any text, and the input of
 * Read is an image, which the start page's text field never holds — a pasted image is caught by the tool's own page.
 * Data only: it imports its history declaration and nothing else at run time — never the component, the logic or `qr`.
 */
import { qrHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'qr',
  title: 'QR Code',
  summary: 'Make a QR code from text or Wi-Fi details, or read one from an image.',
  keywords: ['qr', 'qr code', 'barcode', 'scan', 'decode', 'generate', 'wifi', 'svg', 'png'],
  order: 25,
  history: qrHistory,
  // The code is made from what the person types, at every change — there is no Generate button — and read from the
  // image they give: nothing is made on request, so nothing is copied unasked (docs/tools/copying.md).
  output: { origin: 'input' },
  load: () => import('./QrTool'),
};
