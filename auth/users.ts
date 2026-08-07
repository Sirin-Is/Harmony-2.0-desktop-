import config from '../supabase-config.json';
import { cachedHarmonyUser, cacheHarmonyUser, currentSession, fetchWithTimeout, signOut } from './session';
import { readJsonResponse } from '../data/network-response';

export type HarmonyRole = 'administrator' | 'accountant' | 'observer';
export type HarmonyUser = { userId: string; login: string; displayName: string; role: HarmonyRole; isActive: boolean; workspaceId: string };
export type ManagedUser = Omit<HarmonyUser, 'workspaceId'> & { workspaceId?: string; email?: string; createdAt?: string; bound: boolean };

const baseUrl = String(config.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const apiKey = String(config.SUPABASE_ANON_KEY || '');
const MAX_PROFILE_RESPONSE_BYTES = 128 * 1024;
const MAX_MANAGEMENT_RESPONSE_BYTES = 2 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sessionHeaders() {
  const session = await currentSession();
  if (!session?.access_token) throw new Error('Потрібно увійти для синхронізації.');
  return { apikey: apiKey, Authorization: `Bearer ${session.access_token}` };
}

async function readError(response: Response) {
  const body = await readJsonResponse<Record<string, unknown> | null>(response, 64 * 1024).catch(() => null);
  const message = body?.error ?? body?.message;
  return typeof message === 'string' && message.trim() ? message : 'Не вдалося виконати запит.';
}

export function parseHarmonyProfile(value: unknown, expectedUserId: string): HarmonyUser | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  if (profile.user_id !== expectedUserId || !uuidPattern.test(expectedUserId)
      || !uuidPattern.test(String(profile.workspace_id || ''))
      || !['administrator', 'accountant', 'observer'].includes(String(profile.role || ''))
      || profile.is_active !== true
      || typeof profile.login !== 'string' || profile.login.length < 3 || profile.login.length > 40
      || typeof profile.display_name !== 'string' || !profile.display_name.trim() || profile.display_name.length > 80) return null;
  return {
    userId: expectedUserId,
    login: profile.login,
    displayName: profile.display_name,
    role: profile.role as HarmonyRole,
    isActive: true,
    workspaceId: String(profile.workspace_id),
  };
}

export async function getCurrentHarmonyUser(): Promise<HarmonyUser | null> {
  // A cached role may supplement a still-valid access token, but it must never
  // turn a failed refresh of an expired token into an authenticated session.
  const session = await currentSession();
  const id = session?.user?.id;
  if (!id) return null;
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/rest/v1/harmony_users?user_id=eq.${encodeURIComponent(id)}&select=user_id,login,display_name,role,is_active,workspace_id`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (error) {
    const cached = await cachedHarmonyUser();
    if (cached) return cached;
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      await signOut();
      return null;
    }
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => {});
      const cached = await cachedHarmonyUser();
      if (cached) return cached;
    }
    throw new Error(await readError(response));
  }
  const profiles = await readJsonResponse<unknown>(response, MAX_PROFILE_RESPONSE_BYTES);
  if (!Array.isArray(profiles) || profiles.length > 1) throw new Error('Сервер повернув некоректний профіль Harmony.');
  const result = parseHarmonyProfile(profiles[0], id);
  if (!result) return null;
  await cacheHarmonyUser(result);
  return result;
}

export async function manageHarmonyUsers(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetchWithTimeout(`${baseUrl}/functions/v1/manage-harmony-users`, {
    method: 'POST',
    headers: { ...(await sessionHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(await readError(response));
  return readJsonResponse<Record<string, unknown>>(response, MAX_MANAGEMENT_RESPONSE_BYTES);
}

export async function listAuthenticationUsers(): Promise<ManagedUser[]> {
  const result = await manageHarmonyUsers('list-auth');
  if (!Array.isArray(result.users) || result.users.length > 1000) throw new Error('Сервер повернув некоректний список користувачів.');
  return result.users.map((value): ManagedUser => {
    if (!value || typeof value !== 'object') throw new Error('Сервер повернув некоректного користувача.');
    const user = value as Record<string, unknown>;
    const userId = typeof user.userId === 'string' ? user.userId : '';
    const email = typeof user.email === 'string' && user.email.length <= 320 ? user.email : '';
    const createdAt = typeof user.createdAt === 'string' && user.createdAt.length <= 64 ? user.createdAt : '';
    if (!uuidPattern.test(userId)) throw new Error('Сервер повернув некоректний ідентифікатор користувача.');
    if (user.profile === null) return { userId, email, createdAt, bound: false, login: '', displayName: '', role: 'accountant', isActive: true };
    if (!user.profile || typeof user.profile !== 'object') throw new Error('Сервер повернув некоректний профіль користувача.');
    const profile = user.profile as Record<string, unknown>;
    const login = typeof profile.login === 'string' ? profile.login : '';
    const displayName = typeof profile.display_name === 'string' ? profile.display_name : '';
    const role = String(profile.role || '');
    if (login.length < 3 || login.length > 40 || !displayName.trim() || displayName.length > 80
        || !['administrator', 'accountant', 'observer'].includes(role) || typeof profile.is_active !== 'boolean') {
      throw new Error('Сервер повернув некоректний профіль користувача.');
    }
    return { userId, email, createdAt, bound: true, login, displayName, role: role as HarmonyRole, isActive: profile.is_active };
  });
}
