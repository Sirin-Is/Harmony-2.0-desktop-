import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2.111.0/cors';

type Role = 'administrator' | 'accountant' | 'observer';
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MAX_BODY_BYTES = 32 * 1024;
const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    ...extraHeaders,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});
const readLimitedBody = async (request: Request): Promise<string | null> => {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};
const validLogin = (value: string) => /^[a-z0-9._-]{3,40}$/.test(value);
const commonPasswords = new Set(['123456789012', 'adminadminadmin', 'password1234', 'qwerty123456', 'harmony12345']);
const passwordPolicyError = (password: string, login: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) return `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Пароль має містити не більше ${MAX_PASSWORD_LENGTH} символів.`;
  const normalized = password.normalize('NFKC').toLocaleLowerCase('uk-UA');
  if (commonPasswords.has(normalized) || /^(.{1,4})\1+$/u.test(normalized)) return 'Оберіть менш передбачуваний пароль.';
  if (login.length >= 3 && normalized.includes(login.normalize('NFKC').toLocaleLowerCase('uk-UA'))) return 'Пароль не повинен містити логін користувача.';
  const groups = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((pattern) => pattern.test(password)).length;
  return password.length < 16 && groups < 3
    ? 'Використайте щонайменше три групи символів або парольну фразу від 16 символів.'
    : '';
};

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST') return json({ error: 'Метод не підтримується.' }, 405, { Allow: 'POST, OPTIONS' });

    let rawBody: string | null;
    try {
      rawBody = await readLimitedBody(request);
    } catch {
      return json({ error: 'Некоректний JSON.' }, 400);
    }
    if (rawBody === null) return json({ error: 'Запит завеликий.' }, 413);

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload');
      payload = parsed as Record<string, unknown>;
    } catch {
      return json({ error: 'Некоректний JSON.' }, 400);
    }

    const authorization = request.headers.get('Authorization') || '';
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) return json({ error: 'Потрібна авторизація.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new Error('Missing required Supabase environment variables');

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(tokenMatch[1]);
    if (callerError || !caller) return json({ error: 'Потрібна авторизація.' }, 401);

    const { data: profile, error: profileError } = await admin
      .from('harmony_users')
      .select('role,is_active,workspace_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== 'administrator' || !profile.is_active) {
      return json({ error: 'Доступ дозволено лише адміністратору.' }, 403);
    }

    const action = String(payload.action || 'list');
    if (action === 'list') {
      const { data, error } = await admin
        .from('harmony_users')
        .select('user_id,login,display_name,role,is_active,created_at')
        .eq('workspace_id', profile.workspace_id)
        .order('login');
      return error ? json({ error: 'Не вдалося отримати список користувачів.' }, 400) : json({ users: data });
    }

    if (action === 'list-auth') {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) return json({ error: 'Не вдалося отримати Auth-користувачів.' }, 400);
      const { data: profiles, error: profilesError } = await admin
        .from('harmony_users')
        .select('user_id,login,display_name,role,is_active')
        .eq('workspace_id', profile.workspace_id);
      if (profilesError) return json({ error: 'Не вдалося отримати профілі.' }, 400);
      const { data: allProfiles, error: allProfilesError } = await admin.from('harmony_users').select('user_id');
      if (allProfilesError) return json({ error: 'Не вдалося перевірити прив’язки.' }, 400);
      const profileById = new Map((profiles || []).map((item) => [item.user_id, item]));
      const boundUserIds = new Set((allProfiles || []).map((item) => item.user_id));
      return json({
        users: (data.users || [])
          .filter((user) => profileById.has(user.id) || (!boundUserIds.has(user.id) && !user.app_metadata?.harmony_workspace_id))
          .map((user) => ({
            userId: user.id,
            email: user.email || '',
            createdAt: user.created_at,
            profile: profileById.get(user.id) || null,
          })),
      });
    }

    const login = String(payload.login || '').trim().toLowerCase();
    if (!validLogin(login)) {
      return json({ error: 'Логін: 3–40 малих латинських літер, цифр, крапка, дефіс або підкреслення.' }, 400);
    }
    const displayName = String(payload.displayName || '').trim();
    const role = payload.role as Role;
    if (!displayName || displayName.length > 80 || !['administrator', 'accountant', 'observer'].includes(role)) {
      return json({ error: 'Некоректні дані користувача.' }, 400);
    }

    if (action === 'create') {
      const password = String(payload.password || '');
      const passwordError = passwordPolicyError(password, login);
      if (passwordError) return json({ error: passwordError }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email: `${login}@harmony.local`,
        password,
        email_confirm: true,
        app_metadata: { harmony_workspace_id: profile.workspace_id },
      });
      if (error || !data.user) return json({ error: 'Не вдалося створити Auth-користувача.' }, 400);
      const saved = await admin
        .from('harmony_users')
        .insert({ user_id: data.user.id, login, display_name: displayName, role, workspace_id: profile.workspace_id })
        .select()
        .single();
      if (saved.error) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: 'Не вдалося зберегти профіль користувача.' }, 400);
      }
      return json({ user: saved.data }, 201);
    }

    if (action === 'bind') {
      const userId = String(payload.userId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        return json({ error: 'Некоректний ідентифікатор користувача.' }, 400);
      }

      const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
      if (authError || !authData.user) return json({ error: 'Auth-користувача не знайдено.' }, 404);

      const { data: existing, error: existingError } = await admin
        .from('harmony_users')
        .select('workspace_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.workspace_id && existing.workspace_id !== profile.workspace_id) {
        return json({ error: 'Цей користувач належить іншому workspace Harmony.' }, 403);
      }

      const previousMetadata = authData.user.app_metadata || {};
      const metadataChanged = previousMetadata.harmony_workspace_id !== profile.workspace_id;
      if (previousMetadata.harmony_workspace_id && metadataChanged) {
        return json({ error: 'Цей користувач належить іншому workspace Harmony.' }, 403);
      }
      if (metadataChanged) {
        const metadataUpdate = await admin.auth.admin.updateUserById(userId, {
          app_metadata: { ...previousMetadata, harmony_workspace_id: profile.workspace_id },
        });
        if (metadataUpdate.error) return json({ error: 'Не вдалося прив’язати Auth-користувача.' }, 400);
      }

      const saved = await admin
        .from('harmony_users')
        .upsert({
          user_id: userId,
          login,
          display_name: displayName,
          role,
          is_active: payload.isActive !== false,
          workspace_id: profile.workspace_id,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (saved.error) {
        if (metadataChanged) {
          const rollback = await admin.auth.admin.updateUserById(userId, { app_metadata: previousMetadata });
          if (rollback.error) console.error('bind metadata rollback failed:', rollback.error);
        }
        return json({ error: 'Не вдалося зберегти профіль користувача.' }, 400);
      }
      return json({ user: saved.data });
    }

    if (action === 'update') {
      const userId = String(payload.userId || '');
      const password = payload.password ? String(payload.password) : '';
      const passwordError = password ? passwordPolicyError(password, login) : '';
      if (passwordError) return json({ error: passwordError }, 400);

      const { data: target, error: targetError } = await admin
        .from('harmony_users')
        .select('login,display_name,role,is_active')
        .eq('user_id', userId)
        .eq('workspace_id', profile.workspace_id)
        .maybeSingle();
      if (targetError || !target) return json({ error: 'Користувача не знайдено в цьому workspace Harmony.' }, 404);

      const update = await admin.rpc('harmony_admin_update_user', {
        p_workspace_id: profile.workspace_id,
        p_user_id: userId,
        p_login: login,
        p_display_name: displayName,
        p_role: role,
        p_is_active: Boolean(payload.isActive),
      }).single();
      if (update.error?.message?.includes('HARMONY_LAST_ADMIN')) {
        return json({ error: 'Останнього активного адміністратора не можна вимкнути або понизити.' }, 400);
      }
      if (update.error) return json({ error: 'Не вдалося оновити профіль користувача.' }, 400);

      if (password) {
        const changed = await admin.auth.admin.updateUserById(userId, { password });
        if (changed.error) {
          const rollback = await admin
            .from('harmony_users')
            .update({
              login: target.login,
              display_name: target.display_name,
              role: target.role,
              is_active: target.is_active,
            })
            .eq('user_id', userId)
            .eq('workspace_id', profile.workspace_id)
            .eq('updated_at', update.data.updated_at);
          if (rollback.error) console.error('profile rollback failed:', rollback.error);
          return json({ error: 'Не вдалося змінити пароль; зміни профілю скасовано.' }, 400);
        }
      }
      return json({ user: update.data });
    }

    return json({ error: 'Невідома дія.' }, 400);
  } catch (error) {
    console.error('manage-harmony-users failed:', error);
    return json({ error: 'Сервер тимчасово не зміг виконати запит. Повторіть спробу.' }, 500);
  }
});
