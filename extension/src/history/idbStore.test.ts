// @vitest-environment node
/**
 * The IndexedDB store runs the shared contract suite of `HistoryStore` (the same one the in-memory store runs) over
 * fake-indexeddb — an IndexedDB written to the specification for Node. The real IndexedDB of Chrome is exercised by
 * pnpm test:e2e (scripts/e2e-history.mjs) and the measurements (scripts/history-measure.mjs).
 */
import { idbStore } from './idbStore';
import { historyStoreContract } from '@workspace/tools-shared/history/contract';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

let n = 0;
historyStoreContract('IndexedDB', async () =>
  idbStore({ factory: new IDBFactory(), keyRange: IDBKeyRange }, `test-${++n}`),
);
