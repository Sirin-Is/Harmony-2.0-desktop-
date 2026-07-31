// client-model.ts
// Business logic for a single ФОП (client) record. Pure functions only —
// no localStorage, no DOM. Поведінка ідентична client-model.js.

import { escapeHtml, generateId, daysUntil, todayIso } from './utils';
import type { Client, Database, BankAccount } from './types';

export const GROUP_MZP_MULTIPLIERS: Record<string, number> = { '1': 167, '2': 834, '3': 1167 };

export interface RateOption { value: string; label: string }

export const RATE_OPTIONS: Record<string, RateOption[]> = {
  '1': [{ value: '0.1', label: '10%' }],
  '2': [{ value: '0.2', label: '20%' }, { value: '0.15', label: '15%' }, { value: '0.1', label: '10%' }],
  '3': [{ value: '0.05', label: '5%' }, { value: '0.03', label: '3% + ПДВ' }],
  'Загальна': [{ value: '', label: 'Не застосовується' }],
};

export function groupLimitAmount(group: string | undefined, minWage: number): number {
  const multiplier = group ? GROUP_MZP_MULTIPLIERS[group] : undefined;
  return multiplier ? multiplier * (Number(minWage) || 0) : 0;
}

export function groupLimitLabel(group: string | undefined, minWage: number, money: Intl.NumberFormat): string {
  const multiplier = group ? GROUP_MZP_MULTIPLIERS[group] : undefined;
  return multiplier ? `${money.format(groupLimitAmount(group, minWage))} (${multiplier} МЗП)` : 'Не застосовується';
}

export function rateOptionsForGroup(group: string | undefined): RateOption[] {
  return (group && RATE_OPTIONS[group]) || RATE_OPTIONS['1'];
}

export function rateText(item: Client): string {
  const rate = Number(item.rate) || 0;
  if (String(item.group) === '3' && String(item.rate) === '0.03') return '3% + ПДВ';
  return rate ? `${rate * 100}%` : '-';
}

/** Split a free-form phone field (newline/comma/semicolon separated) into escaped `<br>`-joined lines. */
export function phoneLines(value?: string): string {
  const parts = String(value || '').split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.map(escapeHtml).join('<br>') : '-';
}

/** Render a client's "Зв'язок" field as a clickable link only for recognizably safe schemes. */
export function contactLinkHtml(item: Client): string {
  const raw = (item.contactLink || '').trim();
  if (!raw) return '-';
  const safeHref = /^https?:\/\//i.test(raw) ? raw : (/^t\.me\//i.test(raw) ? `https://${raw}` : null);
  return safeHref
    ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(raw)}</a>`
    : escapeHtml(raw);
}

/** Plain KEP countdown for filters and other non-HTML consumers. */
export function kepDaysLabel(dateStr?: string): string {
  const diff = daysUntil(dateStr);
  return diff === null ? '-' : `${Math.abs(diff)} дн.`;
}

/** Render the KEP-expiry countdown as a colored pill (or em dash if no date set). */
export function kepStatusLabel(dateStr?: string): string {
  const diff = daysUntil(dateStr);
  if (diff === null) return '-';
  if (diff < 0) return `<span class="pill late">Прострочено ${Math.abs(diff)} дн.</span>`;
  if (diff === 0) return `<span class="pill warn">Сьогодні</span>`;
  if (diff <= 30) return `<span class="pill warn">${diff} дн.</span>`;
  return `<span class="pill ok">${diff} дн.</span>`;
}

export const findClientById = (db: Database, id: string): Client | undefined => db.clients.find((item) => item.id === id);
export const findClientByName = (db: Database, name: string): Client | undefined => {
  const normalized = name.trim().toLowerCase();
  return db.clients.find((item) => item.name?.trim().toLowerCase() === normalized);
};
export function lifecycleOf(item: Client): 'active' | 'inactive' | 'deleted' {
  if (item.lifecycleStatus === 'deleted') return 'deleted';
  if (item.lifecycleStatus === 'inactive' || item.archived) return 'inactive';
  return 'active';
}

export const visibleClients = (db: Database): Client[] => db.clients.filter((item) => lifecycleOf(item) === 'active');
export const archivedClients = (db: Database): Client[] => db.clients.filter((item) => lifecycleOf(item) === 'inactive');
export const deletedClients = (db: Database): Client[] => db.clients.filter((item) => lifecycleOf(item) === 'deleted');

/**
 * Create or update a client from validated form field values.
 * Initializes db.monthlyPayments for brand-new clients.
 */
export function upsertClient(
  db: Database,
  fields: Partial<Client>,
  existingId: string | null,
): { record: Client; isNew: boolean } {
  const existing = existingId ? findClientById(db, existingId) : null;
  const record: Client = { ...(existing || {}), ...fields, id: existingId || generateId(), form: 'ФОП', lifecycleStatus: existing ? lifecycleOf(existing) : 'active' } as Client;
  if (existing) {
    Object.assign(existing, record);
    return { record: existing, isNew: false };
  }
  db.clients.push(record);
  db.monthlyPayments[record.id] = {};
  return { record, isNew: true };
}

export function setLifecycleStatus(db: Database, id: string, status: 'active' | 'inactive' | 'deleted', reason = ''): Client | null {
  const item = findClientById(db, id);
  if (!item) return null;
  item.lifecycleStatus = status;
  item.archived = status !== 'active'; // compatibility with old exported backups
  if (status === 'inactive') {
    item.inactiveReason = reason;
    item.inactiveAt = todayIso();
    item.deletedAt = '';
    item.deletionRequestedAt = '';
    item.deletionEligibleAt = '';
  } else if (status === 'deleted') {
    item.deletedAt = todayIso();
  } else {
    item.inactiveReason = '';
    item.inactiveAt = '';
    item.deletedAt = '';
    item.deletionRequestedAt = '';
    item.deletionEligibleAt = '';
  }
  return item;
}

/** Keep a requested deletion recoverable for 30 full calendar days. */
export function requestDeletion(db: Database, id: string, reason: string): Client | null {
  const item = findClientById(db, id);
  if (!item || lifecycleOf(item) !== 'inactive' || !reason.trim()) return null;
  const requested = new Date(`${todayIso()}T00:00:00`);
  requested.setDate(requested.getDate() + 30);
  item.inactiveReason = reason.trim();
  item.deletionRequestedAt = todayIso();
  item.deletionEligibleAt = requested.toISOString().slice(0, 10);
  return item;
}

/** Move overdue deletion requests into the recoverable recycle bin. */
export function advanceScheduledDeletions(db: Database): boolean {
  const today = todayIso();
  let changed = false;
  db.clients.forEach((item) => {
    if (lifecycleOf(item) !== 'inactive' || !item.deletionEligibleAt || item.deletionEligibleAt > today) return;
    item.lifecycleStatus = 'deleted';
    item.archived = true;
    item.deletedAt = today;
    changed = true;
  });
  return changed;
}

/** Permanently delete a client and every piece of data keyed by their id. */
export function deleteClient(db: Database, id: string): boolean {
  const existed = findClientById(db, id);
  if (!existed) return false;
  db.clients = db.clients.filter((item) => item.id !== id);
  delete db.monthlyPayments[id];
  delete db.incomeRecords[id];
  Object.keys(db.taxRecords).forEach((key) => { if (key.startsWith(`${id}|`)) delete db.taxRecords[key]; });
  Object.keys(db.reportRecords).forEach((key) => { if (key.startsWith(`${id}|`)) delete db.reportRecords[key]; });
  return true;
}

/** Move a client to a new position in the shared clients array (drag-and-drop reordering). */
export function reorderClients(db: Database, sourceId: string, targetId: string): boolean {
  const fromIndex = db.clients.findIndex((item) => item.id === sourceId);
  const toIndex = db.clients.findIndex((item) => item.id === targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return false;
  const [moved] = db.clients.splice(fromIndex, 1);
  db.clients.splice(toIndex, 0, moved);
  return true;
}

export type { BankAccount };
