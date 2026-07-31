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

/** A stable remote position. The tuple prevents records with equal timestamps from being skipped. */
export interface SyncCursor {
  updatedAt: string;
  entityType: string;
  id: string;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  localPayload: string;
  remotePayload: string;
  localIsDeleted: boolean;
  remoteIsDeleted: boolean;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  detectedAt: string;
}

export interface SyncRepository {
  getPendingSyncRecords(limit: number): Promise<SyncRecord[]>;
  markRecordsSynced(records: SyncRecord[], syncedAt: string): Promise<void>;
  applyRemoteRecords(records: SyncRecord[]): Promise<SyncConflict[]>;
  getSyncCursor(): Promise<SyncCursor | null>;
  setSyncCursor(cursor: SyncCursor): Promise<void>;
  logSync(operation: string, entityType: string, entityId: string, status: 'success' | 'error' | 'skipped', message?: string): Promise<void>;
}
