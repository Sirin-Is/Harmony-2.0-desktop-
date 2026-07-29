(function () {
  const DEFAULT_TABLE = 'harmony_state';
  const DEFAULT_FALLBACK_KEY = 'harmony.local.db';

  async function loadDatabase({
    table = DEFAULT_TABLE,
    id = 'default',
    fallbackKey = DEFAULT_FALLBACK_KEY,
  } = {}) {
    try {
      const row = await window.HarmonySupabase.getById(table, id);

      if (Array.isArray(row) && row.length > 0) {
        return row[0].payload ?? row[0];
      }

      if (row && typeof row === 'object') {
        return row.payload ?? row;
      }

      throw new Error('No Supabase row found');
    } catch (err) {
      try {
        const raw = localStorage.getItem(fallbackKey);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  }

  async function saveDatabase(payload, {
    table = DEFAULT_TABLE,
    id = 'default',
    fallbackKey = DEFAULT_FALLBACK_KEY,
  } = {}) {
    try {
      localStorage.setItem(fallbackKey, JSON.stringify(payload));

      const record = {
        id,
        payload,
        updated_at: new Date().toISOString(),
      };

      const existing = await window.HarmonySupabase.getById(table, id).catch(() => null);

      if (existing) {
        if (Array.isArray(existing) && existing.length > 0) {
          await window.HarmonySupabase.update(table, existing[0].id ?? id, record);
        } else {
          await window.HarmonySupabase.update(table, existing.id ?? id, record);
        }
      } else {
        await window.HarmonySupabase.insert(table, record);
      }

      return record;
    } catch (err) {
      localStorage.setItem(fallbackKey, JSON.stringify(payload));
      return { error: String(err) };
    }
  }

  window.HarmonySupabasePersistence = {
    loadDatabase,
    saveDatabase,
    syncDatabase: saveDatabase,
  };
})();