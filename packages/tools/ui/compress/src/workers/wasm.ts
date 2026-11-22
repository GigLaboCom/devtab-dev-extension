/** A wasm module built into the chunk as a `data:` URL (`?inline`) back to its bytes — no fetch, no `data:` load. */
export const dataUrlBytes = (dataUrl: string): Uint8Array => {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
