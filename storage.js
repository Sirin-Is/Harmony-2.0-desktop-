// Local persistence boundary. UI and business modules never access SQLite
// directly; this module owns the repository lifecycle and write debounce.

import { SqliteRepository } from './data/sqlite-repository';
import { SyncManager } from './sync/sync-manager';

const LEGACY_STORAGE_KEY = 'fop-oblik-v1';
let repository = new SqliteRepository();
let syncManager = new SyncManager(repository);
let saveTimer = null;
let pendingDb = null;

/** Dependency-injection seam for repository tests and future adapters. */
export function configureRepository(nextRepository) {
  repository = nextRepository;
  syncManager.stop();
  syncManager = new SyncManager(repository);
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

syncManager.onState((state) => {
  if (state === 'syncing') setLocalStatus('syncing');
  else if (state === 'idle') setLocalStatus('synced');
  else if (state === 'offline') setLocalStatus('offline');
  else if (state === 'error') setLocalStatus('syncError');
});

function readLegacyState() {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Open SQLite and import the last browser-local snapshot once, if present. */
export async function loadDatabase() {
  setLocalStatus('loading');
  try {
    if (await repository.isEmpty()) {
      const legacy = readLegacyState();
      if (legacy && typeof legacy === 'object') await repository.save(legacy);
    }
    const db = await repository.load();
    setLocalStatus('saved');
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
  saveTimer = setTimeout(() => { flushSave().catch(() => {}); }, 500);
}

export async function flushSave() {
  clearTimeout(saveTimer);
  if (pendingDb === null) return;
  const snapshot = pendingDb;
  pendingDb = null;
  try {
    await repository.save(snapshot);
    setLocalStatus('saved');
    syncManager.requestSync('local-change');
  } catch (error) {
    pendingDb = snapshot;
    setLocalStatus('error', error?.message || error);
    console.error('Не вдалося зберегти дані в SQLite:', error);
    throw error;
  }
}

export async function saveNow(db) {
  clearTimeout(saveTimer);
  pendingDb = db;
  await flushSave();
}

export function clearDatabase() {
  throw new Error('Очищення локальної БД має виконуватись окремою контрольованою міграцією.');
}

/** Trigger a safe best-effort synchronization without blocking local UI. */
export function requestSync() {
  syncManager.requestSync('manual');
}

window.addEventListener('beforeunload', () => { if (pendingDb !== null) flushSave().catch(() => {}); });
