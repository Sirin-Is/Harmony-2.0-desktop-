// Local persistence boundary. UI and business modules never access SQLite
// directly; this module owns the repository lifecycle and write debounce.

import { SqliteRepository } from './data/sqlite-repository';
import { SyncManager } from './sync/sync-manager';
import { MAX_TRANSIENT_SAVE_RETRIES, isTransientLocalWriteError, localSaveRetryDelay } from './write-retry.js';

const LEGACY_STORAGE_KEY = 'fop-oblik-v1';
let repository = new SqliteRepository();
let activeWorkspaceId;
let saveTimer = null;
let retryTimer = null;
let pendingDb = null;
let transientSaveRetries = 0;

function createSyncManager(targetRepository) {
  const manager = new SyncManager(targetRepository);
  manager.onState((state) => {
    if (state === 'syncing') setLocalStatus('syncing');
    else if (state === 'idle') setLocalStatus('synced');
    else if (state === 'offline') setLocalStatus('offline');
    else if (state === 'error') setLocalStatus('syncError');
  });
  return manager;
}

let syncManager = createSyncManager(repository);

/** Dependency-injection seam for repository tests and future adapters. */
export function configureRepository(nextRepository) {
  repository = nextRepository;
  syncManager.stop();
  syncManager = createSyncManager(repository);
  activeWorkspaceId = null;
}

function setLocalStatus(status, detail = '') {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const labels = {
    loading: '⏳ Відкриття локальної бази…',
    saving: '⏳ Збереження локально…',
    saved: '✓ Збережено локально',
    syncing: '⟳ Синхронізація…',
    synced: '✓ Локально та синхронізовано',
    offline: '✓ Збережено локально (офлайн)',
    syncError: '⚠ Локально; синхронізація недоступна',
    error: '⚠ Помилка локальної бази',
  };
  const suffix = detail ? `: ${String(detail).replace(/\s+/g, ' ').slice(0, 150)}` : '';
  el.textContent = `${labels[status] || ''}${suffix}`;
  el.title = detail ? String(detail) : '';
  el.className = `sync-status sync-${status}`;
}

function readLegacyState() {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function activateWorkspace(workspaceId) {
  const normalizedWorkspaceId = workspaceId ? String(workspaceId).trim().toLowerCase() : null;
  if (activeWorkspaceId === normalizedWorkspaceId) return;
  await prepareWorkspaceSwitch();
  if (typeof repository.close === 'function') await repository.close();
  const nextRepository = new SqliteRepository(normalizedWorkspaceId);
  try {
    if (normalizedWorkspaceId) await nextRepository.migrateLegacyDatabase();
  } catch (error) {
    await nextRepository.close().catch(() => {});
    throw error;
  }
  repository = nextRepository;
  syncManager = createSyncManager(repository);
  activeWorkspaceId = normalizedWorkspaceId;
}

/** Quiesce the current workspace before auth/session identity can change. */
export async function prepareWorkspaceSwitch() {
  await syncManager.pauseForRestore();
  syncManager.stop();
  if (pendingDb !== null) await flushSave();
}

export function resumeWorkspaceSync() {
  syncManager.start();
}

/** Close the authenticated workspace and leave no database pool active. */
export async function closeDatabase() {
  try {
    await prepareWorkspaceSwitch();
  } finally {
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    saveTimer = null;
    retryTimer = null;
    pendingDb = null;
    transientSaveRetries = 0;
    syncManager.stop();
    if (typeof repository.close === 'function') await repository.close().catch(() => {});
    repository = new SqliteRepository();
    syncManager = createSyncManager(repository);
    activeWorkspaceId = undefined;
    setLocalStatus('');
  }
}

/** Open the SQLite file scoped to one workspace. Signed-out local mode has a
 * separate file and never opens the last authenticated workspace implicitly. */
export async function loadDatabase(workspaceId = null) {
  setLocalStatus('loading');
  try {
    await activateWorkspace(workspaceId);
    if (await repository.isEmpty()) {
      const legacy = readLegacyState();
      if (legacy && typeof legacy === 'object') {
        await repository.save(legacy);
        try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* browser storage is best-effort */ }
      }
    }
    const db = await repository.load();
    setLocalStatus('saved');
    const restoreSyncRequired = await repository.isRestoreSyncRequired?.();
    if (restoreSyncRequired) syncManager.requestRestoreSync();
    syncManager.start();
    return db;
  } catch (error) {
    console.error('Не вдалося відкрити локальну SQLite базу:', error);
    setLocalStatus('error', error?.message || error);
    throw error;
  }
}

/** Read the latest SQLite snapshot after Sync Engine has applied remote rows. */
export async function reloadDatabase() {
  return repository.load();
}

export function scheduleSave(db) {
  pendingDb = db;
  setLocalStatus('saving');
  clearTimeout(saveTimer);
  clearTimeout(retryTimer);
  transientSaveRetries = 0;
  saveTimer = setTimeout(() => { flushSave().catch(() => {}); }, 500);
}

export async function flushSave() {
  clearTimeout(saveTimer);
  if (pendingDb === null) return;
  const snapshot = pendingDb;
  pendingDb = null;
  try {
    await repository.save(snapshot);
    transientSaveRetries = 0;
    setLocalStatus('saved');
    syncManager.requestSync('local-change');
  } catch (error) {
    pendingDb = snapshot;
    setLocalStatus('error', error?.message || error);
    console.error('Не вдалося зберегти дані в SQLite:', error);
    if (isTransientLocalWriteError(error) && transientSaveRetries < MAX_TRANSIENT_SAVE_RETRIES) {
      transientSaveRetries += 1;
      const delay = localSaveRetryDelay(transientSaveRetries);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { flushSave().catch(() => {}); }, delay);
    }
    throw error;
  }
}

export async function saveNow(db) {
  clearTimeout(saveTimer);
  clearTimeout(retryTimer);
  transientSaveRetries = 0;
  pendingDb = db;
  await flushSave();
}

/** Save a restored snapshot without starting the ordinary push-first sync.
 * The caller must request restore sync, which compares cloud data first. */
export async function saveRestoredDatabase(db) {
  await syncManager.pauseForRestore();
  clearTimeout(saveTimer);
  pendingDb = null;
  setLocalStatus('saving');
  try {
    await repository.save(db, { requiresPull: true });
    setLocalStatus('saved');
  } catch (error) {
    setLocalStatus('error', error?.message || error);
    throw error;
  }
}

export function clearDatabase() {
  throw new Error('Очищення локальної БД має виконуватись окремою контрольованою міграцією.');
}

/** Trigger a safe best-effort synchronization without blocking local UI. */
export function requestSync() {
  syncManager.requestSync('manual');
}

export function requestRestoreSync() {
  syncManager.requestRestoreSync();
}

export function getOpenSyncConflicts() {
  return repository.getOpenSyncConflicts();
}

/** Recent local replication diagnostics. They never leave this device. */
export function getRecentSyncLog(limit = 100) {
  return repository.getRecentSyncLog(limit);
}

/** Read-only local SQLite health probe. It never changes business data. */
export function checkLocalDatabase() {
  return repository.checkIntegrity();
}

export async function resolveSyncConflict(id, resolution) {
  const resolved = await repository.resolveSyncConflict(id, resolution);
  if (resolved) syncManager.requestSync('conflict-resolution');
  return resolved;
}

function flushWhenLeaving() {
  if (pendingDb !== null) flushSave().catch(() => {});
}

// A desktop webview can be closed before beforeunload has time to complete an
// async write. Flush as soon as the app is hidden as an additional safeguard.
window.addEventListener('beforeunload', flushWhenLeaving);
window.addEventListener('pagehide', flushWhenLeaving);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushWhenLeaving();
});
