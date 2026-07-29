// storage.js
// The only module that touches localStorage. Everything else asks this
// module to load/save the database, so persistence concerns (schema
// versioning, migrations, corruption recovery, quota errors) live in one
// place instead of being scattered across UI code.

const STORAGE_KEY = 'fop-oblik-v1';
const CORRUPTED_BACKUP_PREFIX = 'fop-oblik-v1-corrupted-';
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Some environments (strict privacy modes, certain file:// setups, storage
 * disabled by policy) throw a SecurityError just from TOUCHING localStorage
 * — not only when it's full. This wrapper makes every call safe so a
 * denied Storage API degrades to "this session isn't saved" instead of
 * crashing the whole app before it even renders.
 */
function safeStorageGetItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    console.warn('[storage] localStorage read denied', err);
    return null;
  }
}

function safeStorageSetItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn('[storage] localStorage write denied', err);
    return false;
  }
}

function safeStorageRemoveItem(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.warn('[storage] localStorage remove denied', err);
    return false;
  }
}

function probeStorageAvailable() {
  try {
    const testKey = '__harmony_storage_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch (err) {
    console.warn('[storage] localStorage unavailable', err);
    return false;
  }
}

function backupCorruptedValue(value) {
  const backupKey = `${CORRUPTED_BACKUP_PREFIX}${Date.now()}`;
  if (safeStorageSetItem(backupKey, value)) {
    return backupKey;
  }
  return null;
}

function createEmptyDatabase() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    clients: [],
    groups: [],
    settings: {},
    payments: [],
    taxes: [],
    dashboards: {},
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function withDefaults(obj) {
  const base = createEmptyDatabase();
  if (!obj || typeof obj !== 'object') return base;
  return {
    ...base,
    ...obj,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    clients: Array.isArray(obj.clients) ? obj.clients : [],
    groups: Array.isArray(obj.groups) ? obj.groups : [],
    payments: Array.isArray(obj.payments) ? obj.payments : [],
    taxes: Array.isArray(obj.taxes) ? obj.taxes : [],
    settings: obj.settings && typeof obj.settings === 'object' ? obj.settings : {},
    dashboards: obj.dashboards && typeof obj.dashboards === 'object' ? obj.dashboards : {},
    meta: {
      ...(base.meta || {}),
      ...(obj.meta || {}),
      updatedAt: obj.meta?.updatedAt || new Date().toISOString(),
    },
  };
}

function migrate(obj) {
  return withDefaults(obj);
}

export function loadDatabase() {
  if (!probeStorageAvailable()) {
    showToast(
      'Локальне сховище браузера недоступне: зміни діятимуть лише до закриття вкладки й не збережуться. Спробуйте інший браузер або дозвольте збереження даних сайту.',
      'error',
      10000,
    );
    return createEmptyDatabase();
  }

  const raw = safeStorageGetItem(STORAGE_KEY);

  let initialDb;
  if (!raw) {
    initialDb = createEmptyDatabase();
  } else {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('Не об’єкт');
      initialDb = migrate(withDefaults(parsed));
    } catch (error) {
      console.error('Дані в localStorage пошкоджені, відновлюю порожню базу:', error);
      const backupKey = backupCorruptedValue(raw);
      showToast(
        backupKey
          ? 'Збережені дані пошкоджені. Стару версію збережено окремо, почато з чистої бази.'
          : 'Збережені дані пошкоджені і їх не вдалося зберегти. Почато з чистої бази.',
        'error',
        8000,
      );
      initialDb = createEmptyDatabase();
    }
  }

  if (window.HarmonySupabasePersistence?.loadDatabase) {
    window.HarmonySupabasePersistence.loadDatabase({
      table: 'harmony_state',
      id: 'default',
      fallbackKey: STORAGE_KEY,
    })
      .then((remoteDb) => {
        if (!remoteDb || typeof remoteDb !== 'object') return;

        const normalized = migrate(withDefaults(remoteDb));

        if (JSON.stringify(initialDb) !== JSON.stringify(normalized)) {
          const merged = withDefaults({
            ...initialDb,
            ...normalized,
            clients: normalized.clients?.length ? normalized.clients : initialDb.clients,
            groups: normalized.groups?.length ? normalized.groups : initialDb.groups,
            payments: normalized.payments?.length ? normalized.payments : initialDb.payments,
            taxes: normalized.taxes?.length ? normalized.taxes : initialDb.taxes,
            settings: normalized.settings && Object.keys(normalized.settings).length ? normalized.settings : initialDb.settings,
            dashboards: normalized.dashboards && Object.keys(normalized.dashboards).length ? normalized.dashboards : initialDb.dashboards,
            meta: {
              ...(initialDb.meta || {}),
              ...(normalized.meta || {}),
            },
          });

          safeStorageSetItem(STORAGE_KEY, JSON.stringify(merged));
          return merged;
        }
      })
      .catch((error) => {
        console.warn('[storage] async Supabase load failed', error);
      });
  }

  return initialDb;
}

export function writeNow(db) {
  if (!probeStorageAvailable()) return false;

  const normalizedDb = withDefaults(db || createEmptyDatabase());
  const saved = safeStorageSetItem(STORAGE_KEY, JSON.stringify(normalizedDb));

  if (window.HarmonySupabasePersistence?.saveDatabase) {
    window.HarmonySupabasePersistence.saveDatabase(normalizedDb, {
      table: 'harmony_state',
      id: 'default',
      fallbackKey: STORAGE_KEY,
    }).catch((error) => {
      console.warn('[storage] async Supabase save failed', error);
    });
  }

  if (saved) return true;

  showToast('Не вдалося зберегти зміни (можливо, вичерпано ліміт сховища браузера).', 'error', 8000);
  return false;
}

export function clearDatabase() {
  safeStorageRemoveItem(STORAGE_KEY);
  return createEmptyDatabase();
}