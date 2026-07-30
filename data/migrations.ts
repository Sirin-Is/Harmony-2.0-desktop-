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
];
