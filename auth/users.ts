import config from '../supabase-config.json';
import { cachedHarmonyUser, cacheHarmonyUser, currentSession, fetchWithTimeout } from './session';

export type HarmonyRole = 'administrator' | 'accountant' | 'observer';
export type HarmonyUser = { userId: string; login: string; displayName: string; role: HarmonyRole; isActive: boolean; workspaceId: string };
export type ManagedUser = HarmonyUser & { email?: string; createdAt?: string; bound?: boolean };

const baseUrl = String(config.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const apiKey = String(config.SUPABASE_ANON_KEY || '');

async function sessionHeaders() {
  const session = await currentSession();
  if (!session?.access_token) throw new Error('Потрібно увійти для синхронізації.');
  return { apikey: apiKey, Authorization: `Bearer ${session.access_token}` };
}

async function readError(response: Response) {
  const body = await response.json().catch(() => null);
  return body?.error || body?.message || 'Не вдалося виконати запит.';
}

export async function getCurrentHarmonyUser(): Promise<HarmonyUser | null> {
  let session;
  try {
    session = await currentSession();
  } catch (error) {
    const cached = await cachedHarmonyUser();
    if (cached) return cached;
    throw error;
  }
  const id = session?.user?.id;
  if (!id) return null;
  try {
    const response = await fetchWithTimeout(`${baseUrl}/rest/v1/harmony_users?user_id=eq.${encodeURIComponent(id)}&select=user_id,login,display_name,role,is_active,workspace_id`, { headers: await sessionHeaders() });
    if (!response.ok) throw new Error(await readError(response));
    const [profile] = await response.json() as Array<{ user_id: string; login: string; display_name: string; role: HarmonyRole; is_active: boolean; workspace_id: string }>;
    if (!profile || !profile.is_active) return null;
    const result = { userId: profile.user_id, login: profile.login, displayName: profile.display_name, role: profile.role, isActive: profile.is_active, workspaceId: profile.workspace_id };
    await cacheHarmonyUser(result);
    return result;
  } catch (error) {
    // The local data store remains useful during an outage. A cached profile
    // keeps its already granted role; it is refreshed on every online launch.
    const cached = await cachedHarmonyUser();
    if (cached) return cached;
    throw error;
  }
}

export async function manageHarmonyUsers(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetchWithTimeout(`${baseUrl}/functions/v1/manage-harmony-users`, { method: 'POST', headers: { ...(await sessionHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function listAuthenticationUsers(): Promise<ManagedUser[]> {
  const result = await manageHarmonyUsers('list-auth');
  return (result.users || []).map((user: Record<string, unknown>) => {
    const profile = user.profile as Record<string, unknown> | null;
    return profile ? { userId: String(user.userId), email: String(user.email || ''), createdAt: String(user.createdAt || ''), bound: true, login: String(profile.login), displayName: String(profile.display_name), role: profile.role as HarmonyRole, isActive: Boolean(profile.is_active) } : { userId: String(user.userId), email: String(user.email || ''), createdAt: String(user.createdAt || ''), bound: false, login: '', displayName: '', role: 'accountant', isActive: true };
  });
}
