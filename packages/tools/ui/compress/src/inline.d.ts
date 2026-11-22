/** A dependency's file built into the chunk as a `data:` URL string (the bundler's `?url&inline`): the wasm modules. */
declare module '*?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}
