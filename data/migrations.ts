export interface SqlMigration {
  version: number;
  name: string;
  statements: string[];
}

// All domain records carry the sync columns from the first local version.
// SyncManager (stage 4) will use these tables without a schema rewrite.
const AUDITED_TABLES = [
  'clients',
  'custom_columns',
  'monthly_payments',
  'tax_records',
  'income_records',
  'report_records',
  'calendar_events',
  'hr_orders',
  'hr_monthly_documents',
  'payroll_records',
  'settings',
];

export const migrations: SqlMigration[] = [
  {
    version: 1,
    name: 'initial_local_crm_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
      ...AUDITED_TABLES.map((table) => `CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        synced_at TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
        sync_status TEXT NOT NULL DEFAULT 'created'
          CHECK (sync_status IN ('created', 'updated', 'synced', 'conflict', 'deleted'))
      )`),
      `CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY NOT NULL,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      ...AUDITED_TABLES.map((table) => `CREATE INDEX IF NOT EXISTS idx_${table}_sync
        ON ${table}(sync_status, updated_at)`),
    ],
  },
  {
    // Existing local databases created before Sync Engine receive this table.
    version: 2,
    name: 'sync_cursor_metadata',
    statements: [`CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`],
  },
  {
    version: 3,
    name: 'calendar_events',
    statements: [`CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, synced_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'created'
    )`, `CREATE INDEX IF NOT EXISTS idx_calendar_events_sync ON calendar_events(sync_status, updated_at)`],
  },
  {
    version: 4,
    name: 'hr_orders',
    statements: [`CREATE TABLE IF NOT EXISTS hr_orders (
      id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, synced_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'created'
    )`, `CREATE INDEX IF NOT EXISTS idx_hr_orders_sync ON hr_orders(sync_status, updated_at)`],
  },
  {
    version: 5,
    name: 'hr_monthly_documents',
    statements: [`CREATE TABLE IF NOT EXISTS hr_monthly_documents (
      id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, synced_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'created'
    )`, `CREATE INDEX IF NOT EXISTS idx_hr_monthly_documents_sync ON hr_monthly_documents(sync_status, updated_at)`],
  },
  { version: 6, name: 'payroll_records', statements: [`CREATE TABLE IF NOT EXISTS payroll_records (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'created')`, `CREATE INDEX IF NOT EXISTS idx_payroll_records_sync ON payroll_records(sync_status, updated_at)`] },
  { version: 7, name: 'audit_log', statements: [`CREATE TABLE IF NOT EXISTS audit_operations (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'created')`, `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'created')`, `CREATE INDEX IF NOT EXISTS idx_audit_operations_sync ON audit_operations(sync_status, updated_at)`, `CREATE INDEX IF NOT EXISTS idx_audit_events_sync ON audit_events(sync_status, updated_at)`] },
  {
    version: 8,
    name: 'sync_conflict_archive',
    statements: [`CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      local_payload TEXT NOT NULL,
      remote_payload TEXT NOT NULL,
      local_updated_at TEXT NOT NULL,
      remote_updated_at TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution TEXT
    )`, `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts(resolved_at, detected_at DESC)`],
  },
  { version: 9, name: 'sync_conflict_deletion_state', statements: [
    `ALTER TABLE sync_conflicts ADD COLUMN local_is_deleted INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE sync_conflicts ADD COLUMN remote_is_deleted INTEGER NOT NULL DEFAULT 0`,
  ] },
  { version: 10, name: 'sync_log_retention_index', statements: [`CREATE INDEX IF NOT EXISTS idx_sync_log_created_at ON sync_log(created_at DESC)`] },
];
