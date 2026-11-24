/**
 * DEVTAB_MOCK_BACKEND — the development mock's address (`pnpm mock:backend`, loopback, its default port). A module of
 * its own so the manifest can name it in the CSP of a `licence:mock` build without importing ./mock.ts, whose keys
 * exist only inside that build (extension/build/licenceOrigin.ts).
 */
export const MOCK_ORIGIN = 'http://127.0.0.1:8790';
