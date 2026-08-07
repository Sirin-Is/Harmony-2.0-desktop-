import config from '../supabase-config.json';
import type { SyncCursor, SyncPushResult, SyncRecord } from '../data/sync-types';
import { currentSession } from '../auth/session';
import { getCurrentHarmonyUser } from '../auth/users';
import { assertSafeIdentifier, validateSyncPayload } from '../data/identifier-validation.js';
import { assertRecordPayloadIdentity } from '../data/record-identity';
import { readJsonResponse, readTextResponse } from '../data/network-response';

const TABLE = 'harmony_records';

type RemoteRow = {
  // Direct table pulls contain these fields; the CAS RPC deliberately omits
  // them because its private function derives the workspace from auth.uid().
  user_id?: string;
  workspace_id?: string;
  entity_type: string;
  id: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  is_deleted: boolean;
  revision: number | string;
  change_seq: number | string;
};

type CasRow = RemoteRow & { status: SyncPushResult['status'] };

const baseUrl = String(config.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const apiKey = String(config.SUPABASE_ANON_KEY || '');
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_SYNC_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_SYNC_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const utf8Encoder = new TextEncoder();
const ENTITY_TYPES = new Set([
  'clients', 'custom_columns', 'monthly_payments', 'tax_records',
  'income_records', 'report_records', 'calendar_events', 'hr_orders',
  'hr_monthly_documents', 'payroll_records', 'audit_operations',
  'audit_events', 'settings',
]);

function validateRecord(entityType: string, id: string, payload: unknown): string {
  if (!ENTITY_TYPES.has(entityType)) throw new Error('Синхронізація містить невідомий тип запису.');
  assertSafeIdentifier(id, 'синхронізація');
  validateSyncPayload(payload);
  assertRecordPayloadIdentity(entityType, id, payload as Record<string, unknown>);
  const serialized = JSON.stringify(payload);
  if (utf8Encoder.encode(serialized).byteLength > MAX_PAYLOAD_BYTES) throw new Error('Запис синхронізації перевищує безпечний розмір.');
  return serialized;
}

function assertConfigured(): void {
  if (!baseUrl || !apiKey) throw new Error('Supabase не налаштовано.');
}

export async function readSyncJsonResponse(response: Response): Promise<unknown> {
  return readJsonResponse(response, MAX_SYNC_RESPONSE_BYTES);
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
      cache: 'no-store',
      redirect: 'error',
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
  if (!response.ok) throw new Error(`Supabase: ${response.status} ${await readTextResponse(response, MAX_ERROR_RESPONSE_BYTES)}`);
  return response;
}

function toCasInput(record: SyncRecord): Record<string, unknown> {
  if (utf8Encoder.encode(record.payload).byteLength > MAX_PAYLOAD_BYTES) throw new Error('Запис синхронізації перевищує безпечний розмір.');
  const payload = JSON.parse(record.payload) as unknown;
  validateRecord(record.entityType, record.id, payload);
  return {
    entity_type: record.entityType,
    id: record.id,
    payload,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    synced_at: record.syncedAt,
    is_deleted: record.isDeleted,
    base_revision: record.revision,
  };
}

function fromRemote(row: RemoteRow, expectedWorkspaceId?: string): SyncRecord {
  if (expectedWorkspaceId && row.workspace_id !== expectedWorkspaceId) throw new Error('Supabase повернув запис з іншого робочого простору.');
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Supabase повернув некоректну ревізію запису.');
  const changeSequence = Number(row.change_seq);
  if (!Number.isSafeInteger(changeSequence) || changeSequence < 1) throw new Error('Supabase повернув некоректну послідовність змін.');
  const payload = validateRecord(row.entity_type, row.id, row.payload);
  return {
    entityType: row.entity_type,
    id: row.id,
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    isDeleted: Boolean(row.is_deleted),
    syncStatus: 'synced',
    revision,
    changeSequence,
  };
}

/** Remote adapter. It deliberately knows nothing about UI or SQLite. */
export class SupabaseGateway {
  async healthcheck(): Promise<void> {
    await request(`${TABLE}?select=id&limit=1`);
  }

  async compareAndSwap(records: SyncRecord[]): Promise<SyncPushResult[]> {
    if (!records.length) return [];
    const session = await currentSession();
    const profile = await getCurrentHarmonyUser();
    if (!session?.user?.id || !profile?.workspaceId) throw new Error('Не вдалося визначити робочий простір Harmony.');
    const body = JSON.stringify({ p_records: records.map(toCasInput) });
    if (utf8Encoder.encode(body).byteLength > MAX_SYNC_REQUEST_BYTES) throw new Error('Пакет синхронізації перевищує безпечний розмір.');
    const response = await request('rpc/harmony_compare_and_swap_records', {
      method: 'POST',
      body,
    });
    const rows = (await readSyncJsonResponse(response)) as CasRow[];
    if (rows.length !== records.length) throw new Error('Supabase повернув неповний результат CAS-синхронізації.');
    return rows.map((row, index) => {
      const expected = records[index];
      if ((row.status !== 'applied' && row.status !== 'conflict')
          || row.entity_type !== expected.entityType || row.id !== expected.id) {
        throw new Error('Supabase повернув некоректний порядок або статус CAS-синхронізації.');
      }
      return { status: row.status, record: fromRemote(row) };
    });
  }

  async pullAfter(cursor: SyncCursor | null, limit: number): Promise<SyncRecord[]> {
    const profile = await getCurrentHarmonyUser();
    if (!profile?.workspaceId) throw new Error('Не вдалося визначити робочий простір Harmony.');
    const safeLimit = Math.max(1, Math.min(Number.isSafeInteger(limit) ? limit : 100, 100));
    const params = new URLSearchParams({ select: '*', order: 'change_seq.asc', limit: String(safeLimit) });
    if (cursor) params.set('change_seq', `gt.${cursor.sequence}`);
    const response = await request(`${TABLE}?${params.toString()}`);
    const rows = (await readSyncJsonResponse(response)) as RemoteRow[];
    if (!Array.isArray(rows) || rows.length > safeLimit) throw new Error('Supabase повернув некоректний пакет синхронізації.');
    return rows.map((row) => fromRemote(row, profile.workspaceId));
  }
}
