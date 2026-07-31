import config from '../supabase-config.json';
import type { SyncCursor, SyncRecord } from '../data/sync-types';
import { currentSession } from '../auth/session';
import { getCurrentHarmonyUser } from '../auth/users';

const TABLE = 'harmony_records';

type RemoteRow = {
  user_id: string;
  workspace_id: string;
  entity_type: string;
  id: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  is_deleted: boolean;
};

const baseUrl = String(config.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const apiKey = String(config.SUPABASE_ANON_KEY || '');
const REQUEST_TIMEOUT_MS = 20_000;

function assertConfigured(): void {
  if (!baseUrl || !apiKey) throw new Error('Supabase не налаштовано.');
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  assertConfigured();
  const session = await currentSession();
  if (!session?.access_token) throw new Error('Потрібно увійти в обліковий запис для синхронізації.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${session.access_token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Supabase не відповідає понад 20 секунд. Синхронізацію буде повторено автоматично.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Supabase: ${response.status} ${await response.text()}`);
  return response;
}

function toRemote(record: SyncRecord, userId: string, workspaceId: string): RemoteRow {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    entity_type: record.entityType,
    id: record.id,
    payload: JSON.parse(record.payload),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    synced_at: record.syncedAt,
    is_deleted: record.isDeleted,
  };
}

function fromRemote(row: RemoteRow): SyncRecord {
  return {
    entityType: row.entity_type,
    id: row.id,
    payload: JSON.stringify(row.payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    isDeleted: Boolean(row.is_deleted),
    syncStatus: 'synced',
  };
}

/** Remote adapter. It deliberately knows nothing about UI or SQLite. */
export class SupabaseGateway {
  async healthcheck(): Promise<void> {
    await request(`${TABLE}?select=id&limit=1`);
  }

  async upsert(records: SyncRecord[]): Promise<void> {
    if (!records.length) return;
    const session = await currentSession();
    const profile = await getCurrentHarmonyUser();
    if (!session?.user?.id || !profile?.workspaceId) throw new Error('Не вдалося визначити робочий простір Harmony.');
    await request(`${TABLE}?on_conflict=workspace_id,entity_type,id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(records.map((record) => toRemote(record, session.user!.id!, profile.workspaceId))),
    });
  }

  async pullAfter(cursor: SyncCursor | null, limit: number): Promise<SyncRecord[]> {
    const params = new URLSearchParams({ select: '*', order: 'updated_at.asc,entity_type.asc,id.asc', limit: String(limit) });
    if (cursor) {
      const timestamp = cursor.updatedAt;
      const type = cursor.entityType;
      const id = cursor.id;
      // PostgREST has no tuple comparison, so express the lexicographic cursor
      // explicitly: timestamp, then entity type, then record id.
      params.set('or', `(updated_at.gt.${timestamp},and(updated_at.eq.${timestamp},entity_type.gt.${type}),and(updated_at.eq.${timestamp},entity_type.eq.${type},id.gt.${id}))`);
    }
    const response = await request(`${TABLE}?${params.toString()}`);
    return ((await response.json()) as RemoteRow[]).map(fromRemote);
  }
}
