import { invoke } from '@tauri-apps/api/core';
import config from '../supabase-config.json';

type Session = { access_token: string; refresh_token: string; expires_at?: number; user?: { id?: string; email?: string } };
const baseUrl = String(config.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const apiKey = String(config.SUPABASE_ANON_KEY || '');

async function stored(): Promise<Session | null> {
  const raw = await invoke<string | null>('read_auth_session');
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { await signOut(); return null; }
}

async function persist(session: Session): Promise<void> {
  await invoke('write_auth_session', { session: JSON.stringify(session) });
}

async function tokenRequest(path: string, body: Record<string, string>): Promise<Session> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error_description || 'Не вдалося авторизуватися.');
  const session = await response.json() as Session & { expires_in?: number };
  session.expires_at ||= Math.floor(Date.now() / 1000) + Number(session.expires_in || 0);
  return session;
}

export async function signIn(email: string, password: string): Promise<Session> {
  if (!baseUrl || !apiKey) throw new Error('Supabase не налаштовано.');
  const session = await tokenRequest('/auth/v1/token?grant_type=password', { email, password });
  await persist(session);
  return session;
}

export async function signOut(): Promise<void> { await invoke('clear_auth_session'); }

export async function currentSession(): Promise<Session | null> {
  const session = await stored();
  if (!session) return null;
  // Allow offline launch using the last valid access token; refresh only online.
  if (!session.expires_at || session.expires_at > Math.floor(Date.now() / 1000) + 60 || !navigator.onLine) return session;
  const refreshed = await tokenRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
  await persist(refreshed);
  return refreshed;
}

export async function accessToken(): Promise<string | null> { return (await currentSession())?.access_token || null; }
export async function signedInEmail(): Promise<string | null> { return (await currentSession())?.user?.email || null; }
