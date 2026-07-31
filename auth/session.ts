import { invoke } from '@tauri-apps/api/core';
import config from '../supabase-config.json';
import type { HarmonyUser } from './users';

export type Session = { access_token: string; refresh_token: string; expires_at?: number; user?: { id?: string; email?: string }; harmony_profile?: HarmonyUser };
const baseUrl = String(config.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const apiKey = String(config.SUPABASE_ANON_KEY || '');
const NETWORK_TIMEOUT_MS = 20_000;

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Сервер не відповідає понад 20 секунд. Перевірте з’єднання та повторіть спробу.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function stored(): Promise<Session | null> {
  const raw = await invoke<string | null>('read_auth_session');
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { await signOut(); return null; }
}

async function persist(session: Session): Promise<void> {
  await invoke('write_auth_session', { session: JSON.stringify(session) });
}

export async function cacheHarmonyUser(profile: HarmonyUser): Promise<void> {
  const session = await stored();
  if (!session || session.user?.id !== profile.userId) return;
  await persist({ ...session, harmony_profile: profile });
}

export async function cachedHarmonyUser(): Promise<HarmonyUser | null> {
  const session = await stored();
  const profile = session?.harmony_profile;
  return profile && profile.userId === session?.user?.id && profile.isActive ? profile : null;
}

async function tokenRequest(path: string, body: Record<string, string>): Promise<Session> {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error_description || 'Не вдалося авторизуватися.');
  const session = await response.json() as Session & { expires_in?: number };
  session.expires_at ||= Math.floor(Date.now() / 1000) + Number(session.expires_in || 0);
  return session;
}

function loginEmail(login: string): string {
  const value = login.trim().toLowerCase();
  if (value.includes('@')) return value;
  // The original administrator account predates Harmony logins.
  if (value === 'roman') return 'isidarsirin@gmail.com';
  return `${value}@harmony.local`;
}

export async function signIn(login: string, password: string): Promise<Session> {
  if (!baseUrl || !apiKey) throw new Error('Supabase не налаштовано.');
  const session = await tokenRequest('/auth/v1/token?grant_type=password', { email: loginEmail(login), password });
  await persist(session);
  return session;
}

export async function signOut(): Promise<void> { await invoke('clear_auth_session'); }

export async function currentSession(): Promise<Session | null> {
  const session = await stored();
  if (!session) return null;
  // Allow offline launch using the last valid access token; refresh only online.
  if (!session.expires_at || session.expires_at > Math.floor(Date.now() / 1000) + 60 || !navigator.onLine) return session;
  const refreshed = { ...await tokenRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }), harmony_profile: session.harmony_profile };
  await persist(refreshed);
  return refreshed;
}

export async function accessToken(): Promise<string | null> { return (await currentSession())?.access_token || null; }
export async function signedInEmail(): Promise<string | null> { return (await currentSession())?.user?.email || null; }
