import config from '../supabase-config.json';
import type { SyncRecord } from '../data/sync-types';
import { currentSession } from '../auth/session';

const TABLE = 'harmony_records';

type RemoteRow = {
  user_id: string;
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

function assertConfigured(): void {
  if (!baseUrl || !apiKey) throw new Error('Supabase не налаштовано.');
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  assertConfigured();
  const session = await currentSession();
  if (!session?.access_token) throw new Error('Потрібно увійти в обліковий запис для синхронізації.');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase: ${response.status} ${await response.text()}`);
  return response;
}

function toRemote(record: SyncRecord, userId: string): RemoteRow {
  return {
    user_id: userId,
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
    if (!session?.user?.id) throw new Error('Не вдалося визначити користувача Supabase.');
    await request(`${TABLE}?on_conflict=user_id,entity_type,id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(records.map((record) => toRemote(record, session.user!.id!))),
    });
  }

  async pullAfter(cursor: string | null, limit: number): Promise<SyncRecord[]> {
    const params = new URLSearchParams({ select: '*', order: 'updated_at.asc', limit: String(limit) });
    if (cursor) params.set('updated_at', `gt.${cursor}`);
    const response = await request(`${TABLE}?${params.toString()}`);
    return ((await response.json()) as RemoteRow[]).map(fromRemote);
  }
}
