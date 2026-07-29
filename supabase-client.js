(function () {
  const state = { config: null, promise: null };

  function normalizeUrl(raw) {
    if (!raw) return '';
    const base = raw.trim().replace(/\/+$/, '');
    return base.replace(/\/rest\/v1\/?$/, '');
  }

  function getConfigUrl() {
    try {
      return new URL('./supabase-config.json', window.location.href).toString();
    } catch {
      return './supabase-config.json';
    }
  }

  async function loadConfig() {
    if (state.config) return state.config;

    if (!state.promise) {
      state.promise = fetch(getConfigUrl(), { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Не вдалося прочитати supabase-config.json: ${res.status}`);
          }

          const cfg = await res.json();
          if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
            throw new Error('supabase-config.json має містити SUPABASE_URL і SUPABASE_ANON_KEY');
          }

          state.config = {
            ...cfg,
            SUPABASE_URL: normalizeUrl(cfg.SUPABASE_URL),
          };

          return state.config;
        })
        .catch((err) => {
          state.promise = null;
          throw err;
        });
    }

    return state.promise;
  }

  async function request(method, path, payload, query = {}) {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await loadConfig();

    const url = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path.replace(/^\//, '')}`);

    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });

    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const init = { method, headers };

    if (['POST', 'PATCH', 'PUT'].includes(method) && payload !== undefined) {
      init.body = JSON.stringify(payload);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase ${method} ${path} failed: ${response.status} ${text}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  window.HarmonySupabase = {
    loadConfig,
    isConfigured: async () => {
      try {
        await loadConfig();
        return true;
      } catch {
        return false;
      }
    },
    get: (table, query = {}) => request('GET', table, undefined, query),
    getById: (table, id) => request('GET', `${table}?id=eq.${encodeURIComponent(id)}`),
    insert: (table, payload) => request('POST', table, payload),
    upsert: (table, payload) => request('POST', table, payload),
    update: (table, id, payload) => request('PATCH', `${table}?id=eq.${encodeURIComponent(id)}`, payload),
    remove: (table, id) => request('DELETE', `${table}?id=eq.${encodeURIComponent(id)}`),
  };
})();