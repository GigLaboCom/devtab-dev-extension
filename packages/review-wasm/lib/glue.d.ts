// Types of the module's wasm-bindgen JS (pkg/review_wasm.js, built with --no-typescript): the four exports of
// crates/review-wasm/src/lib.rs and the init function.
declare module '*/pkg/review_wasm.js' {
  const init: (options?: { module_or_path?: string | URL | Request }) => Promise<unknown>;
  export default init;
  export const run: (optionsJson?: string | null) => void;
  export const set_theme: (dark: boolean, name?: string | null, sourceJson?: string | null) => void;
  export const compare_texts: (requestJson: string) => void;
  export const show_diff: (payloadJson: string) => void;
}
