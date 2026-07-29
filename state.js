// state.js
// The single source of truth for application data. Every mutation the UI
// wants to perform goes through an exported action here, which updates
// `db` and schedules a save. Views only ever read `db` and call actions —
// they never mutate `db.clients` etc. directly. This is what keeps
// business logic, storage, and UI cleanly separated.

import * as storage from './storage.js';
import * as clientModel from './client-model.js';
import { getTaxRecord } from './tax-model.js';
import { toNumber, generateId } from './utils.js';

export let db = storage.loadDatabase();

/** Flush any pending debounced write immediately (call before page unload / destructive ops). */
export function flushPendingSave() {
  storage.flushSave();
}

function save() {
  storage.scheduleSave(db);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const getVisibleClients = () => clientModel.visibleClients(db);
export const getArchivedClients = () => clientModel.archivedClients(db);
export const getClientById = (id) => clientModel.findClientById(db, id);
export const findClientByName = (name) => clientModel.findClientByName(db, name);
export const getClientsByGroup = (group) => getVisibleClients().filter((item) => String(item.group) === group);

/** Create or update a client. `fields.customFields` (if present) is merged, not replaced. */
export function upsertClient(fields, existingId) {
  const result = clientModel.upsertClient(db, fields, existingId);
  save();
  return result;
}

export function archiveClient(id, archived) {
  const item = clientModel.setArchived(db, id, archived);
  if (item) save();
  return item;
}

export function deleteClientPermanently(id) {
  const removed = clientModel.deleteClient(db, id);
  if (removed) storage.saveNow(db); // deletions are destructive: write immediately, don't debounce
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
// Custom columns (Огляд)
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

/**
 * Set a single (client, month, charged|paid) cell. Accepts "-" as an explicit
 * "no value" marker (matching the sheet's original convention) or a decimal number.
 * @returns {boolean} whether the value was accepted as valid
 */
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

export function getTaxField(clientId, group, period, taxType) {
  return getTaxRecord(db, clientId, group, period, taxType);
}

export function setTaxField(clientId, group, period, taxType, field, value) {
  const record = getTaxRecord(db, clientId, group, period, taxType);
  record[field] = value;
  save();
  return record;
}

/** Set one field (e.g. "deadline") to the same value for every client x tax-type in a period. Big time-saver: most clients in a group share the same legal deadline. */
export function bulkSetTaxField(clientIds, group, period, taxTypeKeys, field, value) {
  clientIds.forEach((clientId) => {
    taxTypeKeys.forEach((taxType) => {
      getTaxRecord(db, clientId, group, period, taxType)[field] = value;
    });
  });
  save();
  return clientIds.length * taxTypeKeys.length;
}

/**
 * Carry "deadline" and "exemption" forward from the previous period into
 * the current one, for every client x tax-type — but only into fields
 * that are still empty, and deliberately NEVER "queuedDate"/"paidDate"/
 * "note": pre-filling those would make an unpaid new period look like it
 * was already paid, which is exactly the kind of mistake this tool
 * should prevent, not cause.
 * @returns {number} how many fields were actually filled in
 */
export function copyTaxPeriodForward(clientIds, group, fromPeriod, toPeriod, taxTypeKeys) {
  let filled = 0;
  const carryFields = ['deadline', 'exemption'];
  clientIds.forEach((clientId) => {
    taxTypeKeys.forEach((taxType) => {
      const source = getTaxRecord(db, clientId, group, fromPeriod, taxType);
      const target = getTaxRecord(db, clientId, group, toPeriod, taxType);
      carryFields.forEach((field) => {
        if (!target[field] && source[field]) {
          target[field] = source[field];
          filled += 1;
        }
      });
    });
  });
  if (filled) save();
  return filled;
}

// ---------------------------------------------------------------------------
// Bulk import / full-database restore
// ---------------------------------------------------------------------------

/** Replace the entire in-memory database (used by "restore from backup file"). */
export function replaceDatabase(newDb) {
  db = newDb;
  storage.saveNow(db);
}
