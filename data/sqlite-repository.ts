import Database from '@tauri-apps/plugin-sql';
import { migrations } from './migrations';
import type { Database as AppDatabase } from '../types';
import { normalizeWorkingYear } from '../utils';
import type { LocalRepository } from './repository';
import type { SyncRecord, SyncRepository, SyncStatus } from './sync-types';

type Row = { id: string; payload: string };
type SyncRow = { id: string; payload: string; created_at: string; updated_at: string; synced_at: string | null; is_deleted: number; sync_status: SyncStatus };

const DATABASE_URL = 'sqlite:harmony.db';
const TABLES = ['clients', 'custom_columns', 'monthly_payments', 'tax_records', 'income_records', 'report_records', 'settings'];

const emptyDatabase = (): AppDatabase => ({
  clients: [], customColumns: [], monthlyPayments: {}, taxRecords: {}, incomeRecords: {}, reportRecords: {},
  settings: { workingYear: 2026, availableWorkingYears: [2026, 2027], minWage: 8647, monthlyDeadlines: {}, quarterlyDeadlines: { group3: {}, esv: {} }, reportDeadlines: { annual: {}, quarterly: { q1: '', half: '', '9m': '', year: '' } } },
});

function normalizeDatabase(raw: Partial<AppDatabase> | null | undefined): AppDatabase {
  const base = emptyDatabase();
  const settings = raw?.settings as Partial<AppDatabase['settings']> | undefined;
  const legacyAnnual = typeof settings?.reportDeadlines?.annual === 'string' ? settings.reportDeadlines.annual : '';
  const workingYear = Math.max(2026, normalizeWorkingYear(settings?.workingYear));
  const configuredYears = Array.isArray(settings?.availableWorkingYears)
    ? settings.availableWorkingYears.map(normalizeWorkingYear).filter((year) => year >= 2026)
    : base.settings.availableWorkingYears;
  const availableWorkingYears = [...new Set([...configuredYears, workingYear].filter((year) => year >= 2026))].sort((a, b) => a - b);
  return {
    clients: Array.isArray(raw?.clients) ? raw.clients : [],
    customColumns: Array.isArray(raw?.customColumns) ? raw.customColumns : [],
    monthlyPayments: raw?.monthlyPayments || {}, taxRecords: raw?.taxRecords || {}, incomeRecords: raw?.incomeRecords || {}, reportRecords: raw?.reportRecords || {},
    settings: {
      workingYear,
      availableWorkingYears,
      minWage: settings?.minWage ?? base.settings.minWage,
      monthlyDeadlines: settings?.monthlyDeadlines || {},
      quarterlyDeadlines: { group3: settings?.quarterlyDeadlines?.group3 || {}, esv: settings?.quarterlyDeadlines?.esv || {} },
      reportDeadlines: {
        annual: typeof settings?.reportDeadlines?.annual === 'object' && settings.reportDeadlines.annual ? settings.reportDeadlines.annual : (legacyAnnual ? { 2026: legacyAnnual } : {}),
        quarterly: settings?.reportDeadlines?.quarterly || base.settings.reportDeadlines.quarterly,
      },
    },
  };
}

const now = () => new Date().toISOString();
const parse = <T>(payload: string): T | null => { try { return JSON.parse(payload) as T; } catch { return null; } };

export class SqliteRepository implements LocalRepository, SyncRepository {
  private connection: Database | null = null;
  // Queue SQL operations so background sync cannot interleave with a local edit.
  private writeTail: Promise<void> = Promise.resolve();

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async db(): Promise<Database> {
    if (this.connection) return this.connection;
    this.connection = await Database.load(DATABASE_URL);
    // A second writer may briefly hold SQLite while Sync Engine changes status.
    // Wait rather than failing a user edit with SQLITE_BUSY.
    await this.connection.execute('PRAGMA busy_timeout = 10000');
    await this.runMigrations(this.connection);
    return this.connection;
  }

  private async runMigrations(database: Database): Promise<void> {
    // The migration journal cannot be queried until the first launch creates it.
    // Keep this bootstrap idempotent so opening an existing database is safe too.
    await database.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    const applied = await database.select<{ version: number }[]>('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(applied.map((row) => row.version));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      for (const statement of migration.statements) await database.execute(statement);
      await database.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [migration.version, migration.name, now()]);
    }
  }

  async load(): Promise<AppDatabase> {
    const database = await this.db();
    const [clients, columns, monthly, taxes, income, reports, settings] = await Promise.all(
      TABLES.map((table) => database.select<Row[]>(`SELECT id, payload FROM ${table} WHERE is_deleted = 0`)),
    );
    const result = emptyDatabase();
    result.clients = clients.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['clients'];
    result.customColumns = columns.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['customColumns'];
    for (const row of monthly) {
      const data = parse<{ clientId: string; monthKey: string; value: unknown }>(row.payload);
      if (data) (result.monthlyPayments[data.clientId] ||= {})[data.monthKey] = data.value as never;
    }
    for (const row of taxes) { const data = parse<{ key: string; value: unknown }>(row.payload); if (data) result.taxRecords[data.key] = data.value as never; }
    for (const row of income) { const data = parse<{ clientId: string; monthKey: string; value: string }>(row.payload); if (data) (result.incomeRecords[data.clientId] ||= {})[data.monthKey] = data.value; }
    for (const row of reports) { const data = parse<{ key: string; value: unknown }>(row.payload); if (data) result.reportRecords[data.key] = data.value as never; }
    const settingsRecord = settings.map((row) => parse<AppDatabase['settings']>(row.payload)).find(Boolean);
    if (settingsRecord) result.settings = settingsRecord;
    return normalizeDatabase(result);
  }

  async isEmpty(): Promise<boolean> {
    const database = await this.db();
    const rows = await database.select<{ count: number }[]>('SELECT COUNT(*) AS count FROM clients WHERE is_deleted = 0');
    return Number(rows[0]?.count || 0) === 0;
  }

  async save(snapshot: AppDatabase): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const normalized = normalizeDatabase(snapshot);
      try {
        await this.replaceRows(database, 'clients', normalized.clients.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'custom_columns', normalized.customColumns.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'monthly_payments', Object.entries(normalized.monthlyPayments).flatMap(([clientId, months]) => Object.entries(months).map(([monthKey, value]) => ({ id: `${clientId}|${monthKey}`, payload: { clientId, monthKey, value } }))));
        await this.replaceRows(database, 'tax_records', Object.entries(normalized.taxRecords).map(([key, value]) => ({ id: key, payload: { key, value } })));
        await this.replaceRows(database, 'income_records', Object.entries(normalized.incomeRecords).flatMap(([clientId, months]) => Object.entries(months).map(([monthKey, value]) => ({ id: `${clientId}|${monthKey}`, payload: { clientId, monthKey, value } }))));
        await this.replaceRows(database, 'report_records', Object.entries(normalized.reportRecords).map(([key, value]) => ({ id: key, payload: { key, value } })));
        await this.replaceRows(database, 'settings', [{ id: 'default', payload: normalized.settings }]);
      } catch (error) { throw error; }
    });
  }

  private async replaceRows(database: Database, table: string, records: Array<{ id: string; payload: unknown }>): Promise<void> {
    const timestamp = now();
    for (const record of records) {
      await database.execute(
        `INSERT INTO ${table} (id, payload, created_at, updated_at, synced_at, is_deleted, sync_status)
         VALUES (?, ?, ?, ?, NULL, 0, 'created')
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at,
           is_deleted = 0, sync_status = CASE WHEN ${table}.sync_status = 'created' THEN 'created' ELSE 'updated' END`,
        [record.id, JSON.stringify(record.payload), timestamp, timestamp],
      );
    }
    const ids = records.map((record) => record.id);
    const filter = ids.length ? `id NOT IN (${ids.map(() => '?').join(', ')})` : '1 = 1';
    await database.execute(`UPDATE ${table} SET is_deleted = 1, updated_at = ?, sync_status = 'deleted' WHERE is_deleted = 0 AND ${filter}`, [timestamp, ...ids]);
  }

  async getPendingSyncRecords(limit: number): Promise<SyncRecord[]> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = (await Promise.all(TABLES.map((table) => database.select<SyncRow[]>(
        `SELECT id, payload, created_at, updated_at, synced_at, is_deleted, sync_status FROM ${table}
         WHERE sync_status IN ('created', 'updated', 'deleted') ORDER BY updated_at ASC LIMIT ?`, [limit],
      ).then((items) => items.map((item) => ({ ...item, entityType: table })))))).flat()
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit);
      return rows.map((row) => ({
        entityType: row.entityType, id: row.id, payload: row.payload,
        createdAt: row.created_at, updatedAt: row.updated_at, syncedAt: row.synced_at,
        isDeleted: Boolean(row.is_deleted), syncStatus: row.sync_status,
      }));
    });
  }

  async markRecordsSynced(records: SyncRecord[], syncedAt: string): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      try {
      for (const record of records) {
        await database.execute(
          `UPDATE ${record.entityType} SET sync_status = 'synced', synced_at = ?
           WHERE id = ? AND updated_at = ? AND sync_status IN ('created', 'updated', 'deleted')`,
          [syncedAt, record.id, record.updatedAt],
        );
      }
      } catch (error) { throw error; }
    });
  }

  async applyRemoteRecords(records: SyncRecord[]): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      try {
      for (const record of records) {
        if (!TABLES.includes(record.entityType)) continue;
        const local = await database.select<Pick<SyncRow, 'updated_at' | 'sync_status'>[]>(
          `SELECT updated_at, sync_status FROM ${record.entityType} WHERE id = ?`, [record.id],
        );
        // Last-write-wins: a newer local edit remains queued for the next push.
        if (local[0] && local[0].updated_at > record.updatedAt) continue;
        await database.execute(
          `INSERT INTO ${record.entityType} (id, payload, created_at, updated_at, synced_at, is_deleted, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 'synced')
           ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at,
             is_deleted = excluded.is_deleted, sync_status = 'synced'`,
          [record.id, record.payload, record.createdAt, record.updatedAt, record.syncedAt || record.updatedAt, record.isDeleted ? 1 : 0],
        );
      }
      } catch (error) { throw error; }
    });
  }

  async getSyncCursor(): Promise<string | null> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = await database.select<{ value: string }[]>('SELECT value FROM sync_meta WHERE key = ?', ['remote_cursor']);
      return rows[0]?.value || null;
    });
  }

  async setSyncCursor(cursor: string): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      await database.execute(
        `INSERT INTO sync_meta (key, value, updated_at) VALUES ('remote_cursor', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [cursor, now()],
      );
    });
  }

  async logSync(operation: string, entityType: string, entityId: string, status: 'success' | 'error' | 'skipped', message?: string): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      await database.execute(
        'INSERT INTO sync_log (id, operation, entity_type, entity_id, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`${Date.now()}-${Math.random().toString(16).slice(2)}`, operation, entityType, entityId, status, message || null, now()],
      );
    });
  }
}
