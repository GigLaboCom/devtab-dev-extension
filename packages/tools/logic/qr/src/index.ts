/** @workspace/tool-logic-qr — the QR Code tool's logic, everything its component, its worker and its definition use. */
export * from './logic';
export * from './wifi';
// The two halves of the library, each in its own module: a page that imports only the helpers above loads neither.
export * from './make';
export * from './read';
