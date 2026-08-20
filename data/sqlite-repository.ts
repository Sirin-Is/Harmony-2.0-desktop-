import Database from '@tauri-apps/plugin-sql';
import { isAlreadyAppliedAddColumn, migrations } from './migrations';
import { interpretSqliteCheck, type LocalDatabaseHealth } from './database-health';
import type { Database as AppDatabase } from '../types';
import { normalizeWorkingYear } from '../utils';
import type { LocalMutation, LocalMutationTable, LocalRepository } from './repository';
import { parseStoredSyncCursor, type SyncConflict, type SyncCursor, type SyncLogEntry, type SyncRecord, type SyncRepository, type SyncStatus } from './sync-types';
import { LEGACY_DATABASE_URL, workspaceDatabaseUrl } from './workspace-database';
import { parseStoredObjectPayload } from './stored-payload';
import { assertRecordPayloadIdentity } from './record-identity';
import { validateDatabaseIdentifiers } from './identifier-validation.js';
import { jsonValuesEqual, mergeJsonPayloads } from './three-way-merge';

type Row = { id: string; payload: string };
type SyncRow = { id: string; payload: string; base_payload: string | null; created_at: string; updated_at: string; synced_at: string | null; is_deleted: number; sync_status: SyncStatus; revision: number; change_sequence: number };
type SyncLogRow = { id: string; operation: string; entity_type: string; entity_id: string; status: SyncLogEntry['status']; message: string | null; created_at: string };

function withoutCalendarCompletion(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCalendarCompletion);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['completedAt', 'completedDates', 'completionUpdatedAt'].includes(key))
    .map(([key, item]) => [key, withoutCalendarCompletion(item)]));
}

export function mergeCalendarCompletion(localPayload: string, remotePayload: string): string | null {
  try {
    const local = JSON.parse(localPayload) as Record<string, any>;
    const remote = JSON.parse(remotePayload) as Record<string, any>;
    if (JSON.stringify(withoutCalendarCompletion(local)) !== JSON.stringify(withoutCalendarCompletion(remote))) return null;
    const newer = (left: Record<string, any>, right: Record<string, any>) =>
      String(left.completionUpdatedAt || '') >= String(right.completionUpdatedAt || '') ? left : right;
    const chosen = newer(local, remote);
    remote.completedAt = chosen.completedAt || '';
    remote.completedDates = Array.isArray(chosen.completedDates) ? chosen.completedDates : [];
    remote.completionUpdatedAt = chosen.completionUpdatedAt || '';
    const localSubtasks = new Map((local.subtasks || []).map((item: Record<string, any>) => [item.id, item]));
    remote.subtasks = (remote.subtasks || []).map((item: Record<string, any>) => {
      const localItem = localSubtasks.get(item.id) as Record<string, any> | undefined;
      if (!localItem) return item;
      const selected = newer(localItem, item);
      return { ...item, completedAt: selected.completedAt || '', completedDates: Array.isArray(selected.completedDates) ? selected.completedDates : [], completionUpdatedAt: selected.completionUpdatedAt || '' };
    });
    return JSON.stringify(remote);
  } catch { return null; }
}

const LOCAL_TABLES: LocalMutationTable[] = ['clients', 'custom_columns', 'monthly_payments', 'tax_records', 'income_records', 'report_records', 'calendar_events', 'hr_orders', 'hr_monthly_documents', 'payroll_records', 'audit_operations', 'audit_events', 'settings'];
const LOCAL_TABLE_SET = new Set<string>(LOCAL_TABLES);
// Rollback snapshots can contain the full working database. They stay on the
// device that made the edit; compact audit events remain available to other devices.
const SYNC_TABLES: string[] = LOCAL_TABLES.filter((table) => table !== 'audit_operations');

const emptyDatabase = (): AppDatabase => ({
  clients: [], customColumns: [], monthlyPayments: {}, taxRecords: {}, incomeRecords: {}, reportRecords: {}, calendarEvents: [], hrOrders: [], hrMonthlyDocuments: [], payrollRecords: [], auditOperations: [], auditEvents: [],
  settings: { workingYear: 2026, availableWorkingYears: [2026, 2027], minWage: 8647, monthlyDeadlines: {}, quarterlyDeadlines: { group3: {}, esv: {} }, reportDeadlines: { annual: {}, quarterly: { q1: '', half: '', '9m': '', year: '' } }, payrollDates: {}, appearance: { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 }, activityReferences: {} },
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
      payrollDates: settings?.payrollDates && typeof settings.payrollDates === 'object' ? settings.payrollDates : {},
      appearance: {
        fieldColor: settings?.appearance?.fieldColor || defaultAppearance.fieldColor,
        fieldRadius: settings?.appearance?.fieldRadius ?? defaultAppearance.fieldRadius,
        fieldOpacity: [0, 20, 40, 60, 80, 100].includes(Number(settings?.appearance?.fieldOpacity)) ? Number(settings?.appearance?.fieldOpacity) : defaultAppearance.fieldOpacity,
      },
      activityReferences: {
        kved: Array.isArray(settings?.activityReferences?.kved) ? settings.activityReferences.kved : undefined,
        nace: Array.isArray(settings?.activityReferences?.nace) ? settings.activityReferences.nace : undefined,
      },
      dropdownOptions: {
        prro: Array.isArray((settings as any)?.dropdownOptions?.prro) ? (settings as any).dropdownOptions.prro : [],
        currency: Array.isArray((settings as any)?.dropdownOptions?.currency) ? (settings as any).dropdownOptions.currency : [],
        kepIssuer: Array.isArray((settings as any)?.dropdownOptions?.kepIssuer) ? (settings as any).dropdownOptions.kepIssuer : [],
      },
    },
  };
}

const now = () => new Date().toISOString();
const parse = <T>(payload: string): T | null => { try { return JSON.parse(payload) as T; } catch { return null; } };
const parseDomainRow = <T>(row: Row, table: string): T => {
  const payload = parseStoredObjectPayload<T>(row.payload, table);
  assertRecordPayloadIdentity(table, row.id, payload as Record<string, unknown>);
  return payload;
};

export class SqliteRepository implements LocalRepository, SyncRepository {
  private connection: Database | null = null;
  // Queue SQL operations so background sync cannot interleave with a local edit.
  private writeTail: Promise<void> = Promise.resolve();
  private syncLogWrites = 0;

  constructor(
    private readonly workspaceId: string | null = null,
    private readonly databaseUrl = workspaceDatabaseUrl(workspaceId),
  ) {}

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async db(): Promise<Database> {
    if (this.connection) return this.connection;
    const connection = await Database.load(this.databaseUrl);
    try {
      // WAL lets readers proceed while a short write is in progress. Together
      // with the timeout below this prevents normal sync activity from surfacing
      // as a "database is locked" error to the user.
      try { await connection.execute('PRAGMA journal_mode = WAL'); } catch (error) { console.warn('SQLite WAL is unavailable:', error); }
      // A second writer may briefly hold SQLite while Sync Engine changes status.
      // Wait rather than failing a user edit with SQLITE_BUSY.
      await connection.execute('PRAGMA busy_timeout = 10000');
      await this.runMigrations(connection);
      await this.reconcileEquivalentConflicts(connection);
      await this.assertWorkspaceBinding(connection);
      await this.recoverInterruptedSave(connection);
      this.connection = connection;
      return connection;
    } catch (error) {
      await connection.close(this.databaseUrl).catch(() => {});
      throw error;
    }
  }

  private async assertWorkspaceBinding(database: Database): Promise<void> {
    if (!this.workspaceId) return;
    const rows = await database.select<{ value: string }[]>("SELECT value FROM sync_meta WHERE key = 'workspace_id'");
    const boundWorkspace = rows[0]?.value;
    if (boundWorkspace && boundWorkspace !== this.workspaceId) {
      throw new Error(`Локальна база належить іншому робочому простору (${boundWorkspace}).`);
    }
    if (!boundWorkspace) await this.bindWorkspace(database, this.workspaceId);
  }

  private async bindWorkspace(database: Database, workspaceId: string): Promise<void> {
    await database.execute(
      `INSERT INTO sync_meta (key, value, updated_at) VALUES ('workspace_id', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [workspaceId, now()],
    );
  }

  private async hasAnyRecords(database: Database): Promise<boolean> {
    for (const table of LOCAL_TABLES) {
      const rows = await database.select<{ count: number }[]>(`SELECT COUNT(*) AS count FROM ${table}`);
      if (Number(rows[0]?.count || 0) > 0) return true;
    }
    return false;
  }

  /** Copy the pre-workspace database once without losing revisions, cursor or
   * conflict history. Tauri SQL executes through a pool, so this migration is
   * resumable/idempotent instead of pretending separate execute() calls share
   * one transaction connection. */
  async migrateLegacyDatabase(): Promise<boolean> {
    if (!this.workspaceId || this.databaseUrl === LEGACY_DATABASE_URL) return false;
    const destination = await this.db();
    const legacy = new SqliteRepository(null, LEGACY_DATABASE_URL);
    const source = await legacy.db();
    try {
      const binding = await source.select<{ value: string }[]>("SELECT value FROM sync_meta WHERE key = 'workspace_id'");
      const legacyWorkspace = binding[0]?.value;
      if (legacyWorkspace && legacyWorkspace !== this.workspaceId) return false;
      const sourceHasData = await this.hasAnyRecords(source);
      const destinationHasData = await this.hasAnyRecords(destination);
      const migrationState = await destination.select<{ key: string }[]>(
        "SELECT key FROM sync_meta WHERE key IN ('legacy_migration_in_progress', 'legacy_migration_complete')",
      );
      const stateKeys = new Set(migrationState.map((row) => row.key));
      const resuming = stateKeys.has('legacy_migration_in_progress') && !stateKeys.has('legacy_migration_complete');
      let copied = false;
      if (sourceHasData && (!destinationHasData || resuming)) {
          await destination.execute(
            `INSERT INTO sync_meta (key, value, updated_at) VALUES ('legacy_migration_in_progress', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [this.workspaceId, now()],
          );
          for (const table of LOCAL_TABLES) {
            const rows = await source.select<Array<SyncRow & { entityType?: string }>>(
              `SELECT id, payload, base_payload, created_at, updated_at, synced_at, is_deleted, sync_status, revision, change_sequence FROM ${table}`,
            );
            for (const row of rows) {
              await destination.execute(
                `INSERT INTO ${table} (id, payload, base_payload, created_at, updated_at, synced_at, is_deleted, sync_status, revision, change_sequence)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, base_payload = excluded.base_payload, created_at = excluded.created_at,
                   updated_at = excluded.updated_at, synced_at = excluded.synced_at,
                   is_deleted = excluded.is_deleted, sync_status = excluded.sync_status,
                   revision = excluded.revision, change_sequence = excluded.change_sequence`,
                [row.id, row.payload, row.base_payload, row.created_at, row.updated_at, row.synced_at, row.is_deleted, row.sync_status, row.revision, row.change_sequence],
              );
            }
          }
          const metaRows = await source.select<Array<{ key: string; value: string; updated_at: string }>>(
            "SELECT key, value, updated_at FROM sync_meta WHERE key <> 'workspace_id'",
          );
          for (const row of metaRows) {
            await destination.execute(
              `INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
              [row.key, row.value, row.updated_at],
            );
          }
          const conflicts = await source.select<Array<{
            id: string; entity_type: string; entity_id: string; local_payload: string; remote_payload: string;
            local_updated_at: string; remote_updated_at: string; detected_at: string; resolved_at: string | null;
            resolution: string | null; local_is_deleted: number; remote_is_deleted: number;
          }>>('SELECT id, entity_type, entity_id, local_payload, remote_payload, local_updated_at, remote_updated_at, detected_at, resolved_at, resolution, local_is_deleted, remote_is_deleted FROM sync_conflicts');
          for (const row of conflicts) {
            await destination.execute(
              `INSERT INTO sync_conflicts (id, entity_type, entity_id, local_payload, remote_payload, local_updated_at, remote_updated_at, detected_at, resolved_at, resolution, local_is_deleted, remote_is_deleted)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET entity_type = excluded.entity_type, entity_id = excluded.entity_id,
                 local_payload = excluded.local_payload, remote_payload = excluded.remote_payload,
                 local_updated_at = excluded.local_updated_at, remote_updated_at = excluded.remote_updated_at,
                 detected_at = excluded.detected_at, resolved_at = excluded.resolved_at,
                 resolution = excluded.resolution, local_is_deleted = excluded.local_is_deleted,
                 remote_is_deleted = excluded.remote_is_deleted`,
              [row.id, row.entity_type, row.entity_id, row.local_payload, row.remote_payload, row.local_updated_at, row.remote_updated_at, row.detected_at, row.resolved_at, row.resolution, row.local_is_deleted, row.remote_is_deleted],
            );
          }
          const logs = await source.select<SyncLogRow[]>('SELECT id, operation, entity_type, entity_id, status, message, created_at FROM sync_log');
          for (const row of logs) {
            await destination.execute(
              'INSERT OR IGNORE INTO sync_log (id, operation, entity_type, entity_id, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [row.id, row.operation, row.entity_type, row.entity_id, row.status, row.message, row.created_at],
            );
          }
          await destination.execute(
            `INSERT INTO sync_meta (key, value, updated_at) VALUES ('legacy_migration_complete', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [this.workspaceId, now()],
          );
          await destination.execute("DELETE FROM sync_meta WHERE key = 'legacy_migration_in_progress'");
          copied = true;
      }
      await this.bindWorkspace(source, this.workspaceId);
      return copied;
    } finally {
      await legacy.close();
    }
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    // Passing the path is required when more than one workspace pool exists;
    // close() without it may close every SQL pool owned by the webview.
    if (connection) await connection.close(this.databaseUrl);
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
      for (const statement of migration.statements) {
        try {
          await database.execute(statement);
        } catch (error) {
          if (!isAlreadyAppliedAddColumn(statement, error)) throw error;
        }
      }
      await database.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [migration.version, migration.name, now()]);
    }
  }

  async load(): Promise<AppDatabase> {
    const database = await this.db();
    const [clients, columns, monthly, taxes, income, reports, calendarEvents, hrOrders, hrMonthlyDocuments, payrollRecords, auditOperations, auditEvents, settings] = await Promise.all(
      LOCAL_TABLES.map((table) => database.select<Row[]>(`SELECT id, payload FROM ${table} WHERE is_deleted = 0`)),
    );
    const result = emptyDatabase();
    result.clients = clients.map((row) => parseDomainRow<AppDatabase['clients'][number]>(row, 'clients'));
    result.customColumns = columns.map((row) => parseDomainRow<AppDatabase['customColumns'][number]>(row, 'custom_columns'));
    for (const row of monthly) {
      const data = parseDomainRow<{ clientId: string; monthKey: string; value: unknown }>(row, 'monthly_payments');
      (result.monthlyPayments[data.clientId] ||= {})[data.monthKey] = data.value as never;
    }
    for (const row of taxes) { const data = parseDomainRow<{ key: string; value: unknown }>(row, 'tax_records'); result.taxRecords[data.key] = data.value as never; }
    for (const row of income) { const data = parseDomainRow<{ clientId: string; monthKey: string; value: string }>(row, 'income_records'); (result.incomeRecords[data.clientId] ||= {})[data.monthKey] = data.value; }
    for (const row of reports) { const data = parseDomainRow<{ key: string; value: unknown }>(row, 'report_records'); result.reportRecords[data.key] = data.value as never; }
    result.calendarEvents = calendarEvents.map((row) => parseDomainRow<AppDatabase['calendarEvents'][number]>(row, 'calendar_events'));
    result.hrOrders = hrOrders.map((row) => parseDomainRow<AppDatabase['hrOrders'][number]>(row, 'hr_orders'));
    result.hrMonthlyDocuments = hrMonthlyDocuments.map((row) => parseDomainRow<AppDatabase['hrMonthlyDocuments'][number]>(row, 'hr_monthly_documents'));
    result.payrollRecords = payrollRecords.map((row) => parseDomainRow<AppDatabase['payrollRecords'][number]>(row, 'payroll_records'));
    result.auditOperations = auditOperations.map((row) => parseDomainRow<AppDatabase['auditOperations'][number]>(row, 'audit_operations'));
    result.auditEvents = auditEvents.map((row) => parseDomainRow<AppDatabase['auditEvents'][number]>(row, 'audit_events'));
    const settingsRecord = settings.length ? parseDomainRow<AppDatabase['settings']>(settings[0], 'settings') : null;
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

  /** Read-only SQLite integrity probe for the administrator diagnostics page. */
  async checkIntegrity(): Promise<LocalDatabaseHealth> {
    const database = await this.db();
    const rows = await database.select<Record<string, unknown>[]>('PRAGMA quick_check');
    return { ...interpretSqliteCheck(rows), checkedAt: now() };
  }

  async save(snapshot: AppDatabase, options: { requiresPull?: boolean } = {}): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const normalized = normalizeDatabase(snapshot);
      validateDatabaseIdentifiers(normalized);
      await database.execute(
        `INSERT INTO save_journal (id, payload, requires_pull, created_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload,
           requires_pull = excluded.requires_pull, created_at = excluded.created_at`,
        [JSON.stringify(normalized), options.requiresPull ? 1 : 0, now()],
      );
      try {
        await this.applySnapshot(database, normalized);
        if (options.requiresPull) {
          await database.execute(
            `INSERT INTO sync_meta (key, value, updated_at) VALUES ('restore_sync_required', '1', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [now()],
          );
        }
        await database.execute('DELETE FROM save_journal WHERE id = 1');
      } catch (error) { throw error; }
    });
  }

  /** Persist only rows touched by an ordinary UI edit. This is intentionally
   * separate from save(), whose durable full-snapshot journal is reserved for
   * imports, restores and other bulk replacements. */
  async applyMutations(mutations: LocalMutation[]): Promise<void> {
    if (!mutations.length) return;
    return this.serializeWrite(async () => {
      const database = await this.db();
      const timestamp = now();
      const grouped = new Map<LocalMutationTable, LocalMutation[]>();
      for (const mutation of mutations) {
        if (!LOCAL_TABLE_SET.has(mutation.table)) throw new Error('Невідома локальна таблиця зміни.');
        if (!mutation.id || typeof mutation.id !== 'string') throw new Error('Локальна зміна не має коректного ID.');
        const group = grouped.get(mutation.table) || [];
        group.push(mutation); grouped.set(mutation.table, group);
      }
      for (const [table, tableMutations] of grouped) {
        const deleted = tableMutations.filter((mutation) => mutation.deleted);
        for (let offset = 0; offset < deleted.length; offset += 150) {
          const chunk = deleted.slice(offset, offset + 150);
          await database.execute(
            `UPDATE ${table} SET is_deleted = 1, updated_at = ?, sync_status = 'deleted' WHERE id IN (${chunk.map(() => '?').join(', ')}) AND is_deleted = 0`,
            [timestamp, ...chunk.map((mutation) => mutation.id)],
          );
        }
        const upserts = tableMutations.filter((mutation) => !mutation.deleted);
        for (let offset = 0; offset < upserts.length; offset += 150) {
          const chunk = upserts.slice(offset, offset + 150);
          const values = chunk.map(() => '(?, ?, ?, ?, NULL, 0, \'created\')').join(', ');
          const parameters = chunk.flatMap((mutation) => [mutation.id, JSON.stringify(mutation.payload), timestamp, timestamp]);
          await database.execute(
            `INSERT INTO ${table} (id, payload, created_at, updated_at, synced_at, is_deleted, sync_status)
             VALUES ${values}
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at,
               is_deleted = 0, sync_status = CASE WHEN ${table}.sync_status = 'created' THEN 'created' ELSE 'updated' END`,
            parameters,
          );
        }
      }
    });
  }

  private async applySnapshot(database: Database, normalized: AppDatabase): Promise<void> {
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
  }

  private async recoverInterruptedSave(database: Database): Promise<void> {
    const rows = await database.select<Array<{ payload: string; requires_pull: number }>>(
      'SELECT payload, requires_pull FROM save_journal WHERE id = 1',
    );
    const pending = rows[0];
    if (!pending) return;
    const parsed = parse<Partial<AppDatabase>>(pending.payload);
    if (!parsed || typeof parsed !== 'object') throw new Error('Журнал локального збереження пошкоджено.');
    await this.applySnapshot(database, normalizeDatabase(parsed));
    if (pending.requires_pull) {
      await database.execute(
        `INSERT INTO sync_meta (key, value, updated_at) VALUES ('restore_sync_required', '1', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [now()],
      );
    }
    await database.execute('DELETE FROM save_journal WHERE id = 1');
  }

  async isRestoreSyncRequired(): Promise<boolean> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = await database.select<{ value: string }[]>("SELECT value FROM sync_meta WHERE key = 'restore_sync_required'");
      return rows[0]?.value === '1';
    });
  }

  async clearRestoreSyncRequired(): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      await database.execute("DELETE FROM sync_meta WHERE key = 'restore_sync_required'");
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

  private async reconcileEquivalentConflicts(database: Database): Promise<void> {
    const rows = await database.select<Array<{
      id: string; entity_type: string; entity_id: string; local_payload: string; remote_payload: string;
      local_is_deleted: number; remote_is_deleted: number; remote_updated_at: string;
    }>>(`SELECT id, entity_type, entity_id, local_payload, remote_payload, local_is_deleted, remote_is_deleted, remote_updated_at
         FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY detected_at DESC`);
    for (const conflict of rows) {
      if (!SYNC_TABLES.includes(conflict.entity_type)) continue;
      const localValue = parse<unknown>(conflict.local_payload);
      const remoteValue = parse<unknown>(conflict.remote_payload);
      const current = await database.select<Array<{ payload: string; is_deleted: number; sync_status: SyncStatus }>>(
        `SELECT payload, is_deleted, sync_status FROM ${conflict.entity_type} WHERE id = ?`, [conflict.entity_id],
      );
      const currentValue = current[0] ? parse<unknown>(current[0].payload) : null;
      if (current[0]?.sync_status === 'synced' && currentValue !== null
          && localValue !== null && remoteValue !== null
          && (jsonValuesEqual(currentValue, localValue) || jsonValuesEqual(currentValue, remoteValue))) {
        await database.execute(`UPDATE sync_conflicts SET resolved_at = ?, resolution = 'superseded' WHERE id = ?`, [now(), conflict.id]);
        continue;
      }
      if (localValue === null || remoteValue === null || !jsonValuesEqual(localValue, remoteValue)) continue;
      const appendOnlyAudit = conflict.entity_type === 'audit_events';
      const sameDeletion = Boolean(conflict.local_is_deleted) === Boolean(conflict.remote_is_deleted);
      if (!appendOnlyAudit && !sameDeletion) continue;
      if (current[0]?.sync_status === 'conflict' && currentValue !== null && jsonValuesEqual(currentValue, localValue)) {
        const shouldPushActiveAudit = appendOnlyAudit && Boolean(conflict.remote_is_deleted);
        await database.execute(
          `UPDATE ${conflict.entity_type} SET base_payload = ?, is_deleted = ?, sync_status = ?, synced_at = ? WHERE id = ?`,
          [conflict.remote_payload, appendOnlyAudit ? 0 : conflict.remote_is_deleted, shouldPushActiveAudit ? 'updated' : 'synced', conflict.remote_updated_at, conflict.entity_id],
        );
      }
      await database.execute(
        `UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?`, [now(), appendOnlyAudit ? 'append-only' : 'identical', conflict.id],
      );
    }
  }

  private async resolveArchivedConflicts(database: Database, entityType: string, entityId: string, resolution: string): Promise<void> {
    await database.execute(
      `UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE entity_type = ? AND entity_id = ? AND resolved_at IS NULL`,
      [now(), resolution, entityType, entityId],
    );
  }

  async getPendingSyncRecords(limit: number): Promise<SyncRecord[]> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      const rows = (await Promise.all(SYNC_TABLES.map((table) => database.select<SyncRow[]>(
        `SELECT id, payload, base_payload, created_at, updated_at, synced_at, is_deleted, sync_status, revision, change_sequence FROM ${table}
         WHERE sync_status IN ('created', 'updated', 'deleted') ORDER BY updated_at ASC LIMIT ?`, [limit],
      ).then((items) => items.map((item) => ({ ...item, entityType: table })))))).flat()
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit);
      return rows.map((row) => ({
        entityType: row.entityType, id: row.id, payload: row.payload,
        createdAt: row.created_at, updatedAt: row.updated_at, syncedAt: row.synced_at,
        isDeleted: Boolean(row.is_deleted), syncStatus: row.sync_status, revision: Number(row.revision), changeSequence: Number(row.change_sequence), basePayload: row.base_payload,
      }));
    });
  }

  async acknowledgePush(records: SyncRecord[], syncedAt: string): Promise<void> {
    return this.serializeWrite(async () => {
      const database = await this.db();
      try {
      for (const record of records) {
        await database.execute(
          `UPDATE ${record.entityType}
              SET revision = ?,
                  change_sequence = ?,
                  base_payload = ?,
                  sync_status = CASE WHEN updated_at = ? THEN 'synced' ELSE sync_status END,
                  synced_at = CASE WHEN updated_at = ? THEN ? ELSE synced_at END
            WHERE id = ?`,
          [record.revision, record.changeSequence, record.payload, record.updatedAt, record.updatedAt, syncedAt, record.id],
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
        const local = await database.select<Pick<SyncRow, 'payload' | 'base_payload' | 'updated_at' | 'sync_status' | 'is_deleted' | 'revision'>[]>(
          `SELECT payload, base_payload, updated_at, sync_status, is_deleted, revision FROM ${record.entityType} WHERE id = ?`, [record.id],
        );
        if (local[0] && Number(local[0].revision) > record.revision) continue;
        const localPending = local[0] && ['created', 'updated', 'deleted', 'conflict'].includes(local[0].sync_status);
        const localPayload = local[0] ? parse<unknown>(local[0].payload) : null;
        const remotePayload = parse<unknown>(record.payload);
        const payloadsEqual = localPayload !== null && remotePayload !== null && jsonValuesEqual(localPayload, remotePayload);
        const contentDiffers = local[0] && (!payloadsEqual || Boolean(local[0].is_deleted) !== record.isDeleted);
        if (localPending && record.entityType === 'audit_events' && payloadsEqual) {
          const shouldPushActive = record.isDeleted;
          await database.execute(
            `UPDATE audit_events SET base_payload = ?, is_deleted = 0, revision = ?, change_sequence = ?, synced_at = ?, sync_status = ? WHERE id = ?`,
            [record.payload, record.revision, record.changeSequence, record.syncedAt || record.updatedAt, shouldPushActive ? 'updated' : 'synced', record.id],
          );
          await this.resolveArchivedConflicts(database, record.entityType, record.id, 'append-only');
          continue;
        }
        if (localPending && !contentDiffers) {
          await database.execute(
            `UPDATE ${record.entityType} SET base_payload = ?, revision = ?, change_sequence = ?, synced_at = ?, sync_status = 'synced' WHERE id = ?`,
            [record.payload, record.revision, record.changeSequence, record.syncedAt || record.updatedAt, record.id],
          );
          await this.resolveArchivedConflicts(database, record.entityType, record.id, 'identical');
          continue;
        }
        if (localPending && contentDiffers) {
          const mergedCalendar = record.entityType === 'calendar_events' && !local[0].is_deleted && !record.isDeleted
            ? mergeCalendarCompletion(local[0].payload, record.payload) : null;
          if (mergedCalendar) {
            await database.execute(
              `UPDATE calendar_events SET payload = ?, base_payload = ?, revision = ?, change_sequence = ?, updated_at = ?, sync_status = 'updated' WHERE id = ?`,
              [mergedCalendar, record.payload, record.revision, record.changeSequence, now(), record.id],
            );
            await this.resolveArchivedConflicts(database, record.entityType, record.id, 'auto-merged');
            continue;
          }
          let conflictLocalPayload = local[0].payload;
          let conflictRemotePayload = record.payload;
          if (!local[0].is_deleted && !record.isDeleted && local[0].base_payload) {
            const merge = mergeJsonPayloads(local[0].base_payload, local[0].payload, record.payload);
            if (merge && !merge.conflictPaths.length) {
              await database.execute(
                `UPDATE ${record.entityType} SET payload = ?, base_payload = ?, revision = ?, change_sequence = ?, updated_at = ?, sync_status = 'updated' WHERE id = ?`,
                [JSON.stringify(merge.merged), record.payload, record.revision, record.changeSequence, now(), record.id],
              );
              await this.resolveArchivedConflicts(database, record.entityType, record.id, 'auto-merged');
              continue;
            }
            if (merge) {
              conflictLocalPayload = JSON.stringify(merge.localCandidate);
              conflictRemotePayload = JSON.stringify(merge.remoteCandidate);
            }
          }
          const conflict: SyncConflict = {
            id: `${record.entityType}|${record.id}|${record.updatedAt}`,
            entityType: record.entityType, entityId: record.id,
            localPayload: conflictLocalPayload, remotePayload: conflictRemotePayload,
            localIsDeleted: Boolean(local[0].is_deleted), remoteIsDeleted: record.isDeleted,
            localUpdatedAt: local[0].updated_at, remoteUpdatedAt: record.updatedAt,
            detectedAt: now(),
          };
          await database.execute(
            `INSERT OR IGNORE INTO sync_conflicts (id, entity_type, entity_id, local_payload, remote_payload, local_is_deleted, remote_is_deleted, local_updated_at, remote_updated_at, detected_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [conflict.id, conflict.entityType, conflict.entityId, conflict.localPayload, conflict.remotePayload, conflict.localIsDeleted ? 1 : 0, conflict.remoteIsDeleted ? 1 : 0, conflict.localUpdatedAt, conflict.remoteUpdatedAt, conflict.detectedAt],
          );
          await database.execute(`UPDATE ${record.entityType} SET payload = ?, base_payload = ?, sync_status = 'conflict', revision = ?, change_sequence = ? WHERE id = ?`, [conflictLocalPayload, record.payload, record.revision, record.changeSequence, record.id]);
          conflicts.push(conflict);
          continue;
        }
        await database.execute(
          `INSERT INTO ${record.entityType} (id, payload, base_payload, created_at, updated_at, synced_at, is_deleted, sync_status, revision, change_sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
           ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, base_payload = excluded.base_payload, created_at = excluded.created_at,
              updated_at = excluded.updated_at, synced_at = excluded.synced_at,
              is_deleted = excluded.is_deleted, sync_status = 'synced', revision = excluded.revision,
              change_sequence = excluded.change_sequence`,
          [record.id, record.payload, record.payload, record.createdAt, record.updatedAt, record.syncedAt || record.updatedAt, record.isDeleted ? 1 : 0, record.revision, record.changeSequence],
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
      // Returning null deliberately performs one complete pull and replaces the
      // legacy timestamp cursor without risking skipped server changes.
      return parseStoredSyncCursor(value);
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
        const chosen = parse<unknown>(conflict.remote_payload);
        const baseRows = await database.select<Array<{ base_payload: string | null }>>(
          `SELECT base_payload FROM ${conflict.entity_type} WHERE id = ?`, [conflict.entity_id],
        );
        const base = baseRows[0]?.base_payload ? parse<unknown>(baseRows[0].base_payload) : null;
        const needsPush = chosen === null || base === null || !jsonValuesEqual(chosen, base);
        if (needsPush) {
          await database.execute(
            `UPDATE ${conflict.entity_type} SET payload = ?, updated_at = ?, is_deleted = ?, sync_status = 'updated' WHERE id = ?`,
            [conflict.remote_payload, now(), conflict.remote_is_deleted, conflict.entity_id],
          );
        } else {
          await database.execute(
            `UPDATE ${conflict.entity_type} SET payload = ?, updated_at = ?, synced_at = ?, is_deleted = ?, sync_status = 'synced' WHERE id = ?`,
            [conflict.remote_payload, conflict.remote_updated_at, conflict.remote_updated_at, conflict.remote_is_deleted, conflict.entity_id],
          );
        }
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
