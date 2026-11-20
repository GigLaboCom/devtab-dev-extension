import './load-env.js';

/**
 * Build-time flags, evaluated in the Node/Vite process — never shipped to the browser as-is.
 * `CLI_CEB_DEV` is the single master switch (same contract as the chrome-extensions reference):
 * `pnpm dev` writes it as `true` into `.env` via set_global_env.sh, `pnpm build` as `false`.
 */
export const IS_DEV = process.env['CLI_CEB_DEV'] === 'true';
export const IS_PROD = !IS_DEV;
export const IS_FIREFOX = process.env['CLI_CEB_FIREFOX'] === 'true';
export const IS_CI = process.env['CEB_CI'] === 'true';
