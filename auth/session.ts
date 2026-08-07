import { invoke } from '@tauri-apps/api/core';
import config from '../supabase-config.json';
import type { HarmonyUser } from './users';
import { readJsonResponse } from '../data/network-response';

export type Session = { access_token: string; refresh_token: string; expires_at?: number; user?: { id?: string; email?: string }; harmony_profile?: HarmonyUser };
const baseUrl = String(config.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const apiKey = String(config.SUPABASE_ANON_KEY || '');
const NETWORK_TIMEOUT_MS = 20_000;
const LOGOUT_TIMEOUT_MS = 5_000;
const MAX_AUTH_RESPONSE_BYTES = 256 * 1024;
const MAX_STORED_SESSION_BYTES = 128 * 1024;
const MAX_TOKEN_CHARS = 32 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validProfile(value: unknown, userId: string): value is HarmonyUser {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<HarmonyUser>;
  return profile.userId === userId
    && uuidPattern.test(String(profile.workspaceId || ''))
    && ['administrator', 'accountant', 'observer'].includes(String(profile.role || ''))
    && profile.isActive === true
    && typeof profile.login === 'string' && profile.login.length <= 40
    && typeof profile.displayName === 'string' && profile.displayName.trim().length > 0 && profile.displayName.length <= 80;
}

export function normalizeSessionPayload(value: unknown): Session | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Session & { expires_in?: number };
  const accessToken = typeof source.access_token === 'string' ? source.access_token : '';
  const refreshToken = typeof source.refresh_token === 'string' ? source.refresh_token : '';
  const userId = typeof source.user?.id === 'string' ? source.user.id : '';
  const directExpiry = Number(source.expires_at);
  const expiresIn = Number(source.expires_in);
  const expiresAt = Number.isSafeInteger(directExpiry) && directExpiry > 0
    ? directExpiry
    : Math.floor(Date.now() / 1000) + expiresIn;
  if (!accessToken || accessToken.length > MAX_TOKEN_CHARS || /\s/.test(accessToken)
      || !refreshToken || refreshToken.length > MAX_TOKEN_CHARS || /\s/.test(refreshToken)
      || !uuidPattern.test(userId) || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;
  const email = typeof source.user?.email === 'string' && source.user.email.length <= 320 ? source.user.email : undefined;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    user: { id: userId, ...(email ? { email } : {}) },
    ...(validProfile(source.harmony_profile, userId) ? { harmony_profile: source.harmony_profile } : {}),
  };
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, NETWORK_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error('Сервер не відповідає понад 20 секунд. Перевірте з’єднання та повторіть спробу.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function stored(): Promise<Session | null> {
  const raw = await invoke<string | null>('read_auth_session');
  if (!raw) return null;
  if (new TextEncoder().encode(raw).byteLength > MAX_STORED_SESSION_BYTES) {
    await invoke('clear_auth_session');
    return null;
  }
  try {
    const session = normalizeSessionPayload(JSON.parse(raw));
    if (session) return session;
  } catch { /* cleared below */ }
  await invoke('clear_auth_session');
  return null;
}

async function persist(session: Session): Promise<void> {
  const normalized = normalizeSessionPayload(session);
  if (!normalized) throw new Error('Сервер повернув некоректну сесію.');
  await invoke('write_auth_session', { session: JSON.stringify(normalized) });
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

async function tokenRequest(path: string, body: Record<string, string>, errorMessage: string): Promise<Session> {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) {
    // Auth responses can reveal account state (for example, whether an email is
    // confirmed). The desktop client deliberately exposes one generic message.
    await response.body?.cancel().catch(() => {});
    throw new Error(errorMessage);
  }
  const session = normalizeSessionPayload(await readJsonResponse<unknown>(response, MAX_AUTH_RESPONSE_BYTES));
  if (!session) throw new Error(errorMessage);
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
  const session = await tokenRequest(
    '/auth/v1/token?grant_type=password',
    { email: loginEmail(login), password },
    'Невірний логін або пароль.',
  );
  await persist(session);
  return session;
}

/** Local credentials are erased before remote session revocation can fail. */
export async function signOut(): Promise<void> {
  const session = await stored().catch(() => null);
  await invoke('clear_auth_session');
  if (!session?.access_token || !navigator.onLine || !baseUrl || !apiKey) return;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: apiKey, Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => {});
  } catch { /* Local logout is already complete. */ }
  finally { window.clearTimeout(timeout); }
}

export async function currentSession(): Promise<Session | null> {
  const session = await stored();
  if (!session) return null;
  if (!session.access_token || !session.refresh_token || !session.user?.id || !Number.isFinite(Number(session.expires_at))) {
    await signOut();
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  // Offline access is allowed only while the previously issued access token is
  // still valid. An expired token is never treated as an authenticated session.
  if (Number(session.expires_at) > now + 60) return session;
  if (!navigator.onLine) return null;
  const refreshed = { ...await tokenRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, 'Сеанс завершено. Увійдіть знову.'), harmony_profile: session.harmony_profile };
  await persist(refreshed);
  return refreshed;
}

export async function accessToken(): Promise<string | null> { return (await currentSession())?.access_token || null; }
export async function signedInEmail(): Promise<string | null> { return (await currentSession())?.user?.email || null; }
