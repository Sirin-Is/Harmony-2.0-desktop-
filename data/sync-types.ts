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
  /** Last server revision acknowledged locally; 0 means never uploaded. */
  revision: number;
  /** Commit-ordered position of the last server change in this workspace. */
  changeSequence: number;
}

export interface SyncPushResult {
  status: 'applied' | 'conflict';
  record: SyncRecord;
}

/** A stable, server-assigned position within the current workspace. */
export interface SyncCursor {
  sequence: number;
}

export function parseStoredSyncCursor(value: string): SyncCursor | null {
  try {
    const cursor = JSON.parse(value) as Partial<SyncCursor>;
    return Number.isSafeInteger(cursor.sequence) && Number(cursor.sequence) >= 0
      ? { sequence: Number(cursor.sequence) }
      : null;
  } catch {
    return null;
  }
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

export interface SyncLogEntry {
  id: string;
  operation: string;
  entityType: string;
  entityId: string;
  status: 'success' | 'error' | 'skipped';
  message: string | null;
  createdAt: string;
}

export interface SyncRepository {
  getPendingSyncRecords(limit: number): Promise<SyncRecord[]>;
  acknowledgePush(records: SyncRecord[], syncedAt: string): Promise<void>;
  applyRemoteRecords(records: SyncRecord[]): Promise<SyncConflict[]>;
  getSyncCursor(): Promise<SyncCursor | null>;
  setSyncCursor(cursor: SyncCursor): Promise<void>;
  clearSyncCursor(): Promise<void>;
  isRestoreSyncRequired?(): Promise<boolean>;
  clearRestoreSyncRequired?(): Promise<void>;
  logSync(operation: string, entityType: string, entityId: string, status: 'success' | 'error' | 'skipped', message?: string): Promise<void>;
}
