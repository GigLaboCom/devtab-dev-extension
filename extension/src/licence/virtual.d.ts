/** Modules only the licence variants of the build make (extension/vite.config.ts); without the variant they do not resolve. */
declare module 'virtual:licence-test-key' {
  import type { PublicKeyEntry } from '@extension/licence';

  /** licenceTestKey(): .state/licence-test/public.json — the e2e build's one test key (`kid` test-…). */
  const testKey: PublicKeyEntry;
  export default testKey;
}

declare module 'virtual:licence-mock-keys' {
  import type { PublicKeyEntry } from '@extension/licence';

  /** licenceMockKeys(): .state/mock-backend/public.json — the development mock's two keys (`kid` mock-…-p1, -p2). */
  const mockKeys: readonly PublicKeyEntry[];
  export default mockKeys;
}
