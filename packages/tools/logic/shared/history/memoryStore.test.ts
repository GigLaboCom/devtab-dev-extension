import { historyStoreContract } from './contract';
import { memoryStore } from './memoryStore';

historyStoreContract('memory', async () => memoryStore());
