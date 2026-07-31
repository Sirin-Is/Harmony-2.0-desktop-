import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';

type Role = 'administrator' | 'accountant' | 'observer';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const validLogin = (value: string) => /^[a-z0-9._-]{3,40}$/.test(value);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const authorization = request.headers.get('Authorization') || '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data: { user: caller } } = await admin.auth.getUser(token);
  if (!caller) return json({ error: 'Потрібна авторизація.' }, 401);
  const { data: profile } = await admin.from('harmony_users').select('role,is_active,workspace_id').eq('user_id', caller.id).maybeSingle();
  if (profile?.role !== 'administrator' || !profile.is_active) return json({ error: 'Доступ дозволено лише адміністратору.' }, 403);

  const payload = await request.json().catch(() => ({}));
  const action = String(payload.action || 'list');
  if (action === 'list') {
    const { data, error } = await admin.from('harmony_users').select('user_id,login,display_name,role,is_active,created_at').eq('workspace_id', profile.workspace_id).order('login');
    return error ? json({ error: error.message }, 400) : json({ users: data });
  }
  if (action === 'list-auth') {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return json({ error: error.message }, 400);
    const { data: profiles, error: profilesError } = await admin.from('harmony_users').select('user_id,login,display_name,role,is_active').eq('workspace_id', profile.workspace_id);
    if (profilesError) return json({ error: profilesError.message }, 400);
    const profileById = new Map((profiles || []).map((item) => [item.user_id, item]));
    return json({ users: (data.users || []).filter((user) => profileById.has(user.id)).map((user) => ({
      userId: user.id,
      email: user.email || '',
      createdAt: user.created_at,
      profile: profileById.get(user.id) || null,
    })) });
  }
  const login = String(payload.login || '').trim().toLowerCase();
  if (!validLogin(login)) return json({ error: 'Логін: 3–40 малих латинських літер, цифр, крапка, дефіс або підкреслення.' }, 400);
  const displayName = String(payload.displayName || '').trim();
  const role = payload.role as Role;
  if (!displayName || !['administrator', 'accountant', 'observer'].includes(role)) return json({ error: 'Некоректні дані користувача.' }, 400);

  if (action === 'create') {
    const password = String(payload.password || '');
    if (password.length < 8) return json({ error: 'Пароль має містити щонайменше 8 символів.' }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email: `${login}@harmony.local`, password, email_confirm: true,
      app_metadata: { harmony_workspace_id: profile.workspace_id },
    });
    if (error || !data.user) return json({ error: error?.message || 'Не вдалося створити користувача.' }, 400);
    const saved = await admin.from('harmony_users').insert({ user_id: data.user.id, login, display_name: displayName, role, workspace_id: profile.workspace_id }).select().single();
    if (saved.error) {
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: saved.error.message }, 400);
    }
    return json({ user: saved.data }, 201);
  }
  if (action === 'bind') {
    const userId = String(payload.userId || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Некоректний ідентифікатор користувача.' }, 400);
    const { data: existing } = await admin.from('harmony_users').select('workspace_id').eq('user_id', userId).maybeSingle();
    if (existing?.workspace_id && existing.workspace_id !== profile.workspace_id) return json({ error: 'This user belongs to a different Harmony workspace.' }, 403);
    const saved = await admin.from('harmony_users').upsert({
      user_id: userId,
      login,
      display_name: displayName,
      role,
      is_active: payload.isActive !== false,
      workspace_id: profile.workspace_id,
      updated_at: new Date().toISOString(),
    }).select().single();
    return saved.error ? json({ error: saved.error.message }, 400) : json({ user: saved.data });
  }
  if (action === 'update') {
    const userId = String(payload.userId || '');
    const { data: target, error: targetError } = await admin.from('harmony_users').select('role,is_active').eq('user_id', userId).eq('workspace_id', profile.workspace_id).maybeSingle();
    if (targetError || !target) return json({ error: 'User was not found in this Harmony workspace.' }, 404);
    const remainsAdministrator = role === 'administrator' && Boolean(payload.isActive);
    if (target.role === 'administrator' && target.is_active && !remainsAdministrator) {
      const { count } = await admin.from('harmony_users').select('user_id', { count: 'exact', head: true }).eq('workspace_id', profile.workspace_id).eq('role', 'administrator').eq('is_active', true);
      if ((count || 0) <= 1) return json({ error: 'The last active administrator cannot be disabled or demoted.' }, 400);
    }
    const update = await admin.from('harmony_users').update({ login, display_name: displayName, role, is_active: Boolean(payload.isActive) }).eq('user_id', userId).eq('workspace_id', profile.workspace_id).select().single();
    if (update.error) return json({ error: update.error.message }, 400);
    if (payload.password) {
      const password = String(payload.password);
      if (password.length < 8) return json({ error: 'Пароль має містити щонайменше 8 символів.' }, 400);
      const changed = await admin.auth.admin.updateUserById(userId, { password });
      if (changed.error) return json({ error: changed.error.message }, 400);
    }
    return json({ user: update.data });
  }
  return json({ error: 'Невідома дія.' }, 400);
});
