import Database from '@tauri-apps/plugin-sql';
import { migrations } from './migrations';
import type { Database as AppDatabase } from '../types';
import { normalizeWorkingYear } from '../utils';
import type { LocalRepository } from './repository';
import type { SyncConflict, SyncCursor, SyncLogEntry, SyncRecord, SyncRepository, SyncStatus } from './sync-types';

type Row = { id: string; payload: string };
type SyncRow = { id: string; payload: string; created_at: string; updated_at: string; synced_at: string | null; is_deleted: number; sync_status: SyncStatus };
type SyncLogRow = { id: string; operation: string; entity_type: string; entity_id: string; status: SyncLogEntry['status']; message: string | null; created_at: string };

const DATABASE_URL = 'sqlite:harmony.db';
const LOCAL_TABLES = ['clients', 'custom_columns', 'monthly_payments', 'tax_records', 'income_records', 'report_records', 'calendar_events', 'hr_orders', 'hr_monthly_documents', 'payroll_records', 'audit_operations', 'audit_events', 'settings'];
// Rollback snapshots can contain the full working database. They stay on the
// device that made the edit; compact audit events remain available to other devices.
const SYNC_TABLES = LOCAL_TABLES.filter((table) => table !== 'audit_operations');

const emptyDatabase = (): AppDatabase => ({
  clients: [], customColumns: [], monthlyPayments: {}, taxRecords: {}, incomeRecords: {}, reportRecords: {}, calendarEvents: [], hrOrders: [], hrMonthlyDocuments: [], payrollRecords: [], auditOperations: [], auditEvents: [],
  settings: { workingYear: 2026, availableWorkingYears: [2026, 2027], minWage: 8647, monthlyDeadlines: {}, quarterlyDeadlines: { group3: {}, esv: {} }, reportDeadlines: { annual: {}, quarterly: { q1: '', half: '', '9m': '', year: '' } }, appearance: { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 } },
});

function normalizeDatabase(raw: Partial<AppDatabase> | null | undefined): AppDatabase {
  const base = emptyDatabase();
  const defaultAppearance = { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 };
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
    monthlyPayments: raw?.monthlyPayments || {}, taxRecords: raw?.taxRecords || {}, incomeRecords: raw?.incomeRecords || {}, reportRecords: raw?.reportRecords || {}, calendarEvents: Array.isArray(raw?.calendarEvents) ? raw.calendarEvents : [], hrOrders: Array.isArray(raw?.hrOrders) ? raw.hrOrders : [], hrMonthlyDocuments: Array.isArray(raw?.hrMonthlyDocuments) ? raw.hrMonthlyDocuments : [], payrollRecords: Array.isArray(raw?.payrollRecords) ? raw.payrollRecords : [], auditOperations: Array.isArray(raw?.auditOperations) ? raw.auditOperations : [], auditEvents: Array.isArray(raw?.auditEvents) ? raw.auditEvents : [],
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
      appearance: {
        fieldColor: settings?.appearance?.fieldColor || defaultAppearance.fieldColor,
        fieldRadius: settings?.appearance?.fieldRadius ?? defaultAppearance.fieldRadius,
        fieldOpacity: [0, 20, 40, 60, 80, 100].includes(Number(settings?.appearance?.fieldOpacity)) ? Number(settings?.appearance?.fieldOpacity) : defaultAppearance.fieldOpacity,
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
  private syncLogWrites = 0;

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async db(): Promise<Database> {
    if (this.connection) return this.connection;
    this.connection = await Database.load(DATABASE_URL);
    // WAL lets readers proceed while a short write is in progress. Together
    // with the timeout below this prevents normal sync activity from surfacing
    // as a "database is locked" error to the user.
    try { await this.connection.execute('PRAGMA journal_mode = WAL'); } catch (error) { console.warn('SQLite WAL is unavailable:', error); }
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
    const [clients, columns, monthly, taxes, income, reports, calendarEvents, hrOrders, hrMonthlyDocuments, payrollRecords, auditOperations, auditEvents, settings] = await Promise.all(
      LOCAL_TABLES.map((table) => database.select<Row[]>(`SELECT id, payload FROM ${table} WHERE is_deleted = 0`)),
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
    result.calendarEvents = calendarEvents.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['calendarEvents'];
    result.hrOrders = hrOrders.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['hrOrders'];
    result.hrMonthlyDocuments = hrMonthlyDocuments.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['hrMonthlyDocuments'];
    result.payrollRecords = payrollRecords.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['payrollRecords'];
    result.auditOperations = auditOperations.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['auditOperations'];
    result.auditEvents = auditEvents.map((row) => parse(row.payload)).filter(Boolean) as AppDatabase['auditEvents'];
    const settingsRecord = settings.map((row) => parse<AppDatabase['settings']>(row.payload)).find(Boolean);
    if (settingsRecord) result.settings = settingsRecord;
    return normalizeDatabase(result);
  }

  async isEmpty(): Promise<boolean> {
    const database = await this.db();
    // Settings are persisted even for an intentionally empty client list.
    // They mark that this SQLite database has already been initialized, so a
    // stale browser snapshot can never resurrect deleted clients on launch.
    const rows = await database.select<{ count: number }[]>('SELECT COUNT(*) AS count FROM settings WHERE is_deleted = 0');
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
        await this.replaceRows(database, 'calendar_events', normalized.calendarEvents.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'hr_orders', normalized.hrOrders.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'hr_monthly_documents', normalized.hrMonthlyDocuments.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'payroll_records', normalized.payrollRecords.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'audit_operations', normalized.auditOperations.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'audit_events', normalized.auditEvents.map((item) => ({ id: item.id, payload: item })));
        await this.replaceRows(database, 'settings', [{ id: 'default', payload: normalized.settings }]);
      } catch (error) { throw error; }
    });
  }

  private async replaceRows(database: Database, table: string, records: Array<{ id: string; payload: unknown }>): Promise<void> {
    const timestamp = now();
    const current = await database.select<Pick<SyncRow, 'id' | 'payload' | 'is_deleted'>[]>(
      `SELECT id, payload, is_deleted FROM ${table}`,
    );
    const currentById = new Map(current.map((row) => [row.id, row]));
    for (const record of records) {
      const payload = JSON.stringify(record.payload);
      const existing = currentById.get(record.id);
      // A save receives the whole local snapshot. Do not turn every untouched
      // row into an update, otherwise one edit re-uploads the whole database.
      if (existing && !existing.is_deleted && existing.payload === payload) continue;
      await database.execute(
        `INSERT INTO ${table} (id, payload, created_at, updated_at, synced_at, is_deleted, sync_status)
         VALUES (?, ?, ?, ?, NULL, 0, 'created')
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at,
           is_deleted = 0, sync_status = CASE WHEN ${table}.sync_status = 'created' THEN 'created' ELSE 'updated' END`,
        [record.id, payload, timestamp, timestamp],
      );
    }
    const ids = records.map((record) => record.id);
    const filter = ids.length ? `id NOT IN (${ids.map(() => '?').join(', ')})` : '1 = 1';
    await database.execute(`UPDATE ${table} SET is_deleted = 1, updated_at = ?, sync_status = 'deleted' WHERE is_deleted = 0 AND ${filter}`, [timestamp, ...ids]);
  }

  async getPendingSyncRecords(limit: number): Promise<SyncRecord[]> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = (await Promise.all(SYNC_TABLES.map((table) => database.select<SyncRow[]>(
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

  async applyRemoteRecords(records: SyncRecord[]): Promise<SyncConflict[]> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const conflicts: SyncConflict[] = [];
      try {
      for (const record of records) {
        if (!SYNC_TABLES.includes(record.entityType)) continue;
        const local = await database.select<Pick<SyncRow, 'payload' | 'updated_at' | 'sync_status' | 'is_deleted'>[]>(
          `SELECT payload, updated_at, sync_status, is_deleted FROM ${record.entityType} WHERE id = ?`, [record.id],
        );
        const localPending = local[0] && ['created', 'updated', 'deleted', 'conflict'].includes(local[0].sync_status);
        const contentDiffers = local[0] && (local[0].payload !== record.payload || Boolean(local[0].is_deleted) !== record.isDeleted);
        if (localPending && contentDiffers) {
          const conflict: SyncConflict = {
            id: `${record.entityType}|${record.id}|${record.updatedAt}`,
            entityType: record.entityType, entityId: record.id,
            localPayload: local[0].payload, remotePayload: record.payload,
            localIsDeleted: Boolean(local[0].is_deleted), remoteIsDeleted: record.isDeleted,
            localUpdatedAt: local[0].updated_at, remoteUpdatedAt: record.updatedAt,
            detectedAt: now(),
          };
          await database.execute(
            `INSERT OR IGNORE INTO sync_conflicts (id, entity_type, entity_id, local_payload, remote_payload, local_is_deleted, remote_is_deleted, local_updated_at, remote_updated_at, detected_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [conflict.id, conflict.entityType, conflict.entityId, conflict.localPayload, conflict.remotePayload, conflict.localIsDeleted ? 1 : 0, conflict.remoteIsDeleted ? 1 : 0, conflict.localUpdatedAt, conflict.remoteUpdatedAt, conflict.detectedAt],
          );
          await database.execute(`UPDATE ${record.entityType} SET sync_status = 'conflict' WHERE id = ?`, [record.id]);
          conflicts.push(conflict);
          continue;
        }
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
      return conflicts;
    });
  }

  async getSyncCursor(): Promise<SyncCursor | null> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = await database.select<{ value: string }[]>('SELECT value FROM sync_meta WHERE key = ?', ['remote_cursor']);
      const value = rows[0]?.value;
      if (!value) return null;
      try {
        const cursor = JSON.parse(value) as SyncCursor;
        if (cursor.updatedAt && typeof cursor.entityType === 'string' && typeof cursor.id === 'string') return cursor;
      } catch { /* Legacy cursors were stored as a timestamp. */ }
      return { updatedAt: value, entityType: '', id: '' };
    });
  }

  async setSyncCursor(cursor: SyncCursor): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      await database.execute(
        `INSERT INTO sync_meta (key, value, updated_at) VALUES ('remote_cursor', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [JSON.stringify(cursor), now()],
      );
    });
  }

  async clearSyncCursor(): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      await database.execute("DELETE FROM sync_meta WHERE key = 'remote_cursor'");
    });
  }

  async getOpenSyncConflicts(): Promise<SyncConflict[]> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = await database.select<Array<{
        id: string; entity_type: string; entity_id: string; local_payload: string; remote_payload: string; local_is_deleted: number; remote_is_deleted: number;
        local_updated_at: string; remote_updated_at: string; detected_at: string;
      }>>(`SELECT id, entity_type, entity_id, local_payload, remote_payload, local_is_deleted, remote_is_deleted, local_updated_at, remote_updated_at, detected_at
        FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY detected_at DESC`);
      return rows.map((row) => ({
        id: row.id, entityType: row.entity_type, entityId: row.entity_id,
        localPayload: row.local_payload, remotePayload: row.remote_payload,
        localIsDeleted: Boolean(row.local_is_deleted), remoteIsDeleted: Boolean(row.remote_is_deleted),
        localUpdatedAt: row.local_updated_at, remoteUpdatedAt: row.remote_updated_at, detectedAt: row.detected_at,
      }));
    });
  }

  async resolveSyncConflict(id: string, resolution: 'local' | 'remote'): Promise<boolean> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = await database.select<Array<{
        entity_type: string; entity_id: string; local_payload: string; remote_payload: string; remote_updated_at: string; remote_is_deleted: number;
      }>>(`SELECT entity_type, entity_id, local_payload, remote_payload, remote_updated_at, remote_is_deleted
        FROM sync_conflicts WHERE id = ? AND resolved_at IS NULL`, [id]);
      const conflict = rows[0];
      if (!conflict || !SYNC_TABLES.includes(conflict.entity_type)) return false;
      if (resolution === 'remote') {
        await database.execute(
          `UPDATE ${conflict.entity_type} SET payload = ?, updated_at = ?, synced_at = ?, is_deleted = ?, sync_status = 'synced' WHERE id = ?`,
          [conflict.remote_payload, conflict.remote_updated_at, conflict.remote_updated_at, conflict.remote_is_deleted, conflict.entity_id],
        );
      } else {
        await database.execute(
          `UPDATE ${conflict.entity_type} SET updated_at = ?, sync_status = 'updated' WHERE id = ?`,
          [now(), conflict.entity_id],
        );
      }
      await database.execute(`UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?`, [now(), resolution, id]);
      return true;
    });
  }

  async logSync(operation: string, entityType: string, entityId: string, status: 'success' | 'error' | 'skipped', message?: string): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      await database.execute(
        'INSERT INTO sync_log (id, operation, entity_type, entity_id, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`${Date.now()}-${Math.random().toString(16).slice(2)}`, operation, entityType, entityId, status, message || null, now()],
      );
      // This is diagnostic data only. Keep enough history for support without
      // allowing routine background replication to grow the local database forever.
      this.syncLogWrites += 1;
      if (this.syncLogWrites === 1 || this.syncLogWrites % 100 === 0) {
        await database.execute(`DELETE FROM sync_log WHERE id IN (
          SELECT id FROM sync_log ORDER BY created_at DESC LIMIT -1 OFFSET 5000
        )`);
      }
    });
  }

  async getRecentSyncLog(limit = 100): Promise<SyncLogEntry[]> {
    const database = await this.db();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const rows = await database.select<SyncLogRow[]>(`SELECT id, operation, entity_type, entity_id, status, message, created_at FROM sync_log ORDER BY created_at DESC LIMIT ${safeLimit}`);
    return rows.map((row) => ({ id: row.id, operation: row.operation, entityType: row.entity_type, entityId: row.entity_id, status: row.status, message: row.message, createdAt: row.created_at }));
  }
}
