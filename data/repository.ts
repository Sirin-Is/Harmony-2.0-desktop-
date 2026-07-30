import type { Database } from '../types';

// State depends on this contract, not on the Tauri SQL implementation.
// Tests and a future encrypted/remote replica can supply another adapter.
export interface LocalRepository {
  load(): Promise<Database>;
  save(snapshot: Database): Promise<void>;
  isEmpty(): Promise<boolean>;
}
