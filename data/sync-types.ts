export type SyncStatus = 'created' | 'updated' | 'synced' | 'conflict' | 'deleted';

export interface SyncRecord {
  entityType: string;
  id: string;
  payload: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  isDeleted: boolean;
  syncStatus: SyncStatus;
}

export interface SyncRepository {
  getPendingSyncRecords(limit: number): Promise<SyncRecord[]>;
  markRecordsSynced(records: SyncRecord[], syncedAt: string): Promise<void>;
  applyRemoteRecords(records: SyncRecord[]): Promise<void>;
  getSyncCursor(): Promise<string | null>;
  setSyncCursor(cursor: string): Promise<void>;
  logSync(operation: string, entityType: string, entityId: string, status: 'success' | 'error' | 'skipped', message?: string): Promise<void>;
}
