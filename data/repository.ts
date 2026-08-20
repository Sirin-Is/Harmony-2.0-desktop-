import type { Database } from '../types';
import type { LocalDatabaseHealth } from './database-health';

export type LocalMutationTable =
  | 'clients' | 'custom_columns' | 'monthly_payments' | 'tax_records'
  | 'income_records' | 'report_records' | 'calendar_events' | 'hr_orders'
  | 'hr_monthly_documents' | 'payroll_records' | 'audit_operations'
  | 'audit_events' | 'settings';

export interface LocalMutation {
  table: LocalMutationTable;
  id: string;
  payload?: unknown;
  deleted?: boolean;
}

// State depends on this contract, not on the Tauri SQL implementation.
// Tests and a future encrypted/remote replica can supply another adapter.
export interface LocalRepository {
  load(): Promise<Database>;
  save(snapshot: Database, options?: { requiresPull?: boolean }): Promise<void>;
  applyMutations(mutations: LocalMutation[]): Promise<void>;
  isEmpty(): Promise<boolean>;
  checkIntegrity(): Promise<LocalDatabaseHealth>;
}
