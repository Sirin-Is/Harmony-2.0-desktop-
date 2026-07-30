// state.js
// The single source of truth for application data. Every mutation the UI
// wants to perform goes through an exported action here, which updates
// `db` and schedules a save. Views only ever read `db` and call actions —
// they never mutate `db.clients` etc. directly.
//
// Етап 2: додано initDatabase() — завантаження тепер асинхронне (чекає
// Supabase, як і в app.js), тож `db` більше не ініціалізується синхронно
// при імпорті модуля. bootstrap.js викликає initDatabase() один раз при
// старті (і показує boot-overlay, поки це триває), після чого `db` —
// звичайний live-binding, яким користуються всі інші функції нижче.

import * as storage from './storage.js';
import * as clientModel from './client-model';
import { getTaxRecord, effectiveDeadline as effectiveTaxDeadline, getDefaultDeadline as getDefaultTaxDeadline } from './tax-model.ts';
import { getReportRecord, effectiveReportDeadline } from './report-model.ts';
import { toNumber, generateId } from './utils';

export let db = null;

/** Called once by bootstrap.js before the first render. */
export async function initDatabase() {
  db = await storage.loadDatabase();
  if (clientModel.advanceScheduledDeletions(db)) save();
  return db;
}

/** Refresh the in-memory UI snapshot after a remote pull; local mutations remain repository-owned. */
export async function refreshDatabaseFromSync() {
  db = await storage.reloadDatabase();
  return db;
}

/** Flush any pending debounced write immediately (call before page unload / destructive ops). */
export async function flushPendingSave() {
  await storage.flushSave();
}

function save() {
  storage.scheduleSave(db);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const getVisibleClients = () => clientModel.visibleClients(db);
export const getArchivedClients = () => {
  if (clientModel.advanceScheduledDeletions(db)) save();
  return clientModel.archivedClients(db);
};
export const getDeletedClients = () => {
  if (clientModel.advanceScheduledDeletions(db)) save();
  return clientModel.deletedClients(db);
};
export const getClientById = (id) => clientModel.findClientById(db, id);
export const findClientByName = (name) => clientModel.findClientByName(db, name);
export const getClientsByGroup = (group) => getVisibleClients().filter((item) => String(item.group) === group);
/** '12' groups real groups '1' and '2' together — matches the tax/report tab grouping. */
export const getClientsByTaxTab = (tabKey) => getVisibleClients().filter((item) => (
  tabKey === '3' ? String(item.group) === '3' : ['1', '2'].includes(String(item.group))
));

export function upsertClient(fields, existingId) {
  const result = clientModel.upsertClient(db, fields, existingId);
  save();
  return result;
}

export function setClientLifecycle(id, status, reason = '') {
  const item = clientModel.setLifecycleStatus(db, id, status, reason);
  if (item) save();
  return item;
}

export function archiveClient(id, archived, reason = '') {
  return setClientLifecycle(id, archived ? 'inactive' : 'active', reason);
}

export function requestClientDeletion(id, reason) {
  const item = clientModel.requestDeletion(db, id, reason);
  if (item) save();
  return item;
}

export async function deleteClientPermanently(id) {
  const item = clientModel.findClientById(db, id);
  if (!item?.isTestRecord || clientModel.lifecycleOf(item) !== 'deleted') return false;
  const removed = clientModel.deleteClient(db, id);
  if (removed) await storage.saveNow(db); // deletions are destructive: write immediately, don't debounce
  return removed;
}

export function reorderClients(sourceId, targetId) {
  const moved = clientModel.reorderClients(db, sourceId, targetId);
  if (moved) save();
  return moved;
}

export function setCustomFieldValue(clientId, columnId, value) {
  const item = clientModel.findClientById(db, clientId);
  if (!item) return;
  item.customFields ||= {};
  item.customFields[columnId] = value;
  save();
}

// ---------------------------------------------------------------------------
// Custom columns (Картки клієнтів)
// ---------------------------------------------------------------------------

export const getCustomColumns = () => db.customColumns;

export function addCustomColumn(fields) {
  const column = { id: generateId(), name: fields.name, type: fields.type };
  db.customColumns.push(column);
  save();
  return column;
}

export function updateCustomColumn(id, fields) {
  const column = db.customColumns.find((item) => item.id === id);
  if (!column) return null;
  Object.assign(column, fields);
  save();
  return column;
}

export function deleteCustomColumn(id) {
  const existed = db.customColumns.some((item) => item.id === id);
  if (!existed) return false;
  db.customColumns = db.customColumns.filter((item) => item.id !== id);
  db.clients.forEach((item) => { if (item.customFields) delete item.customFields[id]; });
  save();
  return true;
}

// ---------------------------------------------------------------------------
// Monthly payments (Оплати)
// ---------------------------------------------------------------------------

export function setMonthlyPaymentField(clientId, monthKey, type, rawValue) {
  const normalized = rawValue.trim().replace(',', '.');
  if (normalized !== '-' && normalized !== '' && !Number.isFinite(Number(normalized))) return false;
  const clientData = db.monthlyPayments[clientId] ||= {};
  const monthData = clientData[monthKey] ||= {};
  monthData[type] = normalized === '' ? '-' : normalized;
  save();
  return true;
}

export function getMonthlyCellValue(clientId, monthKey, type) {
  return db.monthlyPayments[clientId]?.[monthKey]?.[type];
}

export function getClientMonthlyTotals(clientId) {
  const monthly = db.monthlyPayments[clientId] || {};
  return Object.values(monthly).reduce(
    (acc, value) => ({ charged: acc.charged + toNumber(value.charged), paid: acc.paid + toNumber(value.paid) }),
    { charged: 0, paid: 0 },
  );
}

// ---------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------

/** `realGroup` is the client's actual group ('1'|'2'|'3'), NOT the '12'/'3' UI tab key. */
export function getTaxField(clientId, realGroup, period, taxType) {
  return getTaxRecord(db, clientId, realGroup, period, taxType);
}

export function setTaxField(clientId, realGroup, period, taxType, field, value) {
  const record = getTaxRecord(db, clientId, realGroup, period, taxType);
  record[field] = value;
  save();
  return record;
}

export function getEffectiveTaxDeadline(realGroup, taxType, period, record) {
  return effectiveTaxDeadline(db, realGroup, taxType, period, record);
}

export function getDefaultTaxDeadlineFor(realGroup, taxType, period) {
  return getDefaultTaxDeadline(db, realGroup, taxType, period);
}

/** Set one field (e.g. "deadline") to the same value for every client x tax-type in a period. */
export function bulkSetTaxField(clientIds, realGroups, period, taxTypeKeys, field, value) {
  clientIds.forEach((clientId, i) => {
    taxTypeKeys.forEach((taxType) => {
      getTaxRecord(db, clientId, realGroups[i], period, taxType)[field] = value;
    });
  });
  save();
  return clientIds.length * taxTypeKeys.length;
}

/** Carry "deadline"/"exemption" forward from the previous period into empty fields of the current one. Never touches paidDate/queuedDate/note. */
export function copyTaxPeriodForward(clientIds, realGroups, fromPeriod, toPeriod, taxTypeKeys) {
  let filled = 0;
  const carryFields = ['deadline', 'exemption'];
  clientIds.forEach((clientId, i) => {
    taxTypeKeys.forEach((taxType) => {
      const source = getTaxRecord(db, clientId, realGroups[i], fromPeriod, taxType);
      const target = getTaxRecord(db, clientId, realGroups[i], toPeriod, taxType);
      carryFields.forEach((field) => {
        if (!target[field] && source[field]) { target[field] = source[field]; filled += 1; }
      });
    });
  });
  if (filled) save();
  return filled;
}

// ---------------------------------------------------------------------------
// Reports (Звітність)
// ---------------------------------------------------------------------------

export function getReportField(clientId, realGroup, period) {
  return getReportRecord(db, clientId, realGroup, period);
}

export function setReportField(clientId, realGroup, period, field, value) {
  const record = getReportRecord(db, clientId, realGroup, period);
  record[field] = value;
  save();
  return record;
}

export function getEffectiveReportDeadline(realGroup, period, record) {
  return effectiveReportDeadline(db, realGroup, period, record);
}

// ---------------------------------------------------------------------------
// Incomes (Доходи)
// ---------------------------------------------------------------------------

export function getIncomeValue(clientId, monthKey) {
  return db.incomeRecords[clientId]?.[monthKey];
}

export function setIncomeValue(clientId, monthKey, rawValue) {
  const normalized = rawValue.trim().replace(',', '.');
  if (normalized !== '' && !Number.isFinite(Number(normalized))) return false;
  const clientData = db.incomeRecords[clientId] ||= {};
  clientData[monthKey] = normalized;
  save();
  return true;
}

export function incomeSum(clientId, monthIndexes, paymentYear) {
  return monthIndexes.reduce((sum, index) => {
    const key = `${paymentYear}-${String(index + 1).padStart(2, '0')}`;
    return sum + toNumber(db.incomeRecords[clientId]?.[key]);
  }, 0);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getSettings = () => db.settings;

export function setWorkingYear(value) {
  const year = Number(value);
  if (!db.settings.availableWorkingYears.includes(year)) return false;
  db.settings.workingYear = year;
  save();
  return true;
}

export function createWorkingYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2026 || year > 2100 || db.settings.availableWorkingYears.includes(year)) return false;
  db.settings.availableWorkingYears.push(year);
  db.settings.availableWorkingYears.sort((a, b) => a - b);
  db.settings.workingYear = year;
  save();
  return true;
}

export function setMinWage(value) {
  db.settings.minWage = toNumber(value);
  save();
}

export function setMonthlyTaxDeadline(periodKey, value) {
  db.settings.monthlyDeadlines[periodKey] = value;
  save();
}

export function setQuarterlyTaxDeadline(taxKey, periodKey, value) {
  db.settings.quarterlyDeadlines[taxKey][periodKey] = value;
  save();
}

export function setReportDeadline(scope, periodKeyOrNull, value) {
  if (scope === 'annual') db.settings.reportDeadlines.annual[periodKeyOrNull] = value;
  else db.settings.reportDeadlines.quarterly[periodKeyOrNull] = value;
  save();
}

// ---------------------------------------------------------------------------
// Bulk import / full-database restore
// ---------------------------------------------------------------------------

/** Replace the entire in-memory database (used by "restore from backup file"). */
export async function replaceDatabase(newDb) {
  db = newDb;
  await storage.saveNow(db);
}
