import type { SyncRecord, SyncRepository } from '../data/sync-types';
import { SupabaseGateway } from './supabase-gateway';
import { getCurrentHarmonyUser } from '../auth/users';

type SyncState = 'idle' | 'syncing' | 'offline' | 'error';
type StateListener = (state: SyncState, detail?: string) => void;

const BATCH_SIZE = 100;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const PERIODIC_SYNC_MS = 5 * 60_000;

/**
 * Idempotent local-first synchronizer. SQLite is always the source for UI;
 * network failures only postpone replication and never reject a local save.
 */
export class SyncManager {
  private running = false;
  private timer: number | null = null;
  private retryMs = INITIAL_BACKOFF_MS;
  private restoreSyncRequested = false;
  private paused = false;
  private idleWaiters: Array<() => void> = [];
  private listeners = new Set<StateListener>();

  constructor(private readonly repository: SyncRepository, private readonly remote = new SupabaseGateway()) {}

  onState(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.requestSync('startup');
  }

  stop(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  requestSync(_reason = 'manual'): void {
    if (!navigator.onLine) return this.emit('offline', 'Немає з’єднання');
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.sync().catch(() => {}), 0);
  }

  /** Restored data must be compared with the complete remote workspace before
   * any local record is permitted to upload. */
  requestRestoreSync(): void {
    this.paused = false;
    this.restoreSyncRequested = true;
    this.requestSync('backup-restore');
  }

  /** Stop future background work and wait until an in-flight sync is done.
   * Used before replacing the complete local snapshot from a backup. */
  async pauseForRestore(): Promise<void> {
    this.paused = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  resume(): void {
    this.paused = false;
    this.requestSync('resume');
  }

  private onOnline = () => this.requestSync('online');
  private onOffline = () => this.emit('offline', 'Немає з’єднання');

  private emit(state: SyncState, detail?: string): void {
    this.listeners.forEach((listener) => listener(state, detail));
  }

  private schedule(delay: number): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.sync().catch(() => {}), delay);
  }

  private async sync(): Promise<void> {
    if (this.running || this.paused || !navigator.onLine) return;
    this.running = true;
    this.emit('syncing');
    try {
      await this.remote.healthcheck();
      const pullBeforePush = this.restoreSyncRequested;
      this.restoreSyncRequested = false;
      if (pullBeforePush) {
        await this.repository.clearSyncCursor();
        await this.pull();
        await this.push();
      } else {
        await this.push();
        await this.pull();
      }
      this.retryMs = INITIAL_BACKOFF_MS;
      this.emit('idle');
      this.schedule(PERIODIC_SYNC_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.logSync('sync', 'system', 'system', 'error', message);
      this.emit('error', message);
      this.schedule(this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_BACKOFF_MS);
    } finally {
      this.running = false;
      const waiters = this.idleWaiters.splice(0);
      waiters.forEach((resolve) => resolve());
    }
  }

  private async push(): Promise<void> {
    const profile = await getCurrentHarmonyUser();
    if (profile?.role === 'observer') return;
    while (true) {
      const batch = await this.repository.getPendingSyncRecords(BATCH_SIZE);
      if (!batch.length) return;
      await this.remote.upsert(batch);
      const syncedAt = new Date().toISOString();
      await this.repository.markRecordsSynced(batch, syncedAt);
      await this.logBatch('push', batch);
      if (batch.length < BATCH_SIZE) return;
    }
  }

  private async pull(): Promise<number> {
    let cursor = await this.repository.getSyncCursor();
    let conflicts = 0;
    while (true) {
      const batch = await this.remote.pullAfter(cursor, BATCH_SIZE);
      if (!batch.length) return conflicts;
      const detected = await this.repository.applyRemoteRecords(batch);
      conflicts += detected.length;
      window.dispatchEvent(new CustomEvent('harmony:remote-sync', { detail: { count: batch.length } }));
      if (detected.length) window.dispatchEvent(new CustomEvent('harmony:sync-conflict', { detail: { conflicts: detected } }));
      await this.logBatch('pull', batch);
      const last = batch[batch.length - 1];
      cursor = { updatedAt: last.updatedAt, entityType: last.entityType, id: last.id };
      await this.repository.setSyncCursor(cursor);
      if (batch.length < BATCH_SIZE) return conflicts;
    }
  }

  private async logBatch(operation: 'push' | 'pull', batch: SyncRecord[]): Promise<void> {
    await Promise.all(batch.map((record) => this.repository.logSync(operation, record.entityType, record.id, 'success')));
  }
}
