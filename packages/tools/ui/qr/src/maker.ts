/**
 * The making half of the library as a chunk of its own: the component imports this module the first time it has a
 * text to make a code of, so opening the tool (or only reading codes) never loads the encoder.
 */
export { buildQr } from '@workspace/tool-logic-qr';
