// client-model.js
// Business logic for a single ФОП (client) record: unified-tax rates,
// annual income limits (sourced from tax-config.js, year by year), KEP-
// expiry countdown, and the CRUD/reorder operations that mutate a
// database object. Pure functions only — no localStorage, no DOM.
// state.js wires these to persistence.

import { escapeHtml, generateId, daysUntil, PAYMENT_YEAR, todayIso } from './utils.js';
import { getYearConfig } from './tax-config.js';

export const GROUP_MZP_MULTIPLIERS = { '1': 167, '2': 834, '3': 1167 };

export function groupLimitAmount(group, minWage) {
  const multiplier = GROUP_MZP_MULTIPLIERS[group];
  return multiplier ? multiplier * (Number(minWage) || 0) : 0;
}

export function groupLimitLabel(group, money, year = PAYMENT_YEAR) {
  const info = getYearConfig(year).groupLimits[group];
  return info ? `${money.format(info.amount)} (${info.minWages} МЗП)` : 'Не застосовується';
}

export function rateOptionsForGroup(group, year = PAYMENT_YEAR) {
  const options = getYearConfig(year).rateOptions;
  return options[group] || options['1'];
}

export function rateText(item) {
  const rate = Number(item.rate) || 0;
  if (String(item.group) === '3' && String(item.rate) === '0.03') return '3% + ПДВ';
  return rate ? `${rate * 100}%` : '-';
}

/** Split a free-form phone field (newline/comma/semicolon separated) into escaped `<br>`-joined lines. */
export function phoneLines(value) {
  const parts = String(value || '').split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.map(escapeHtml).join('<br>') : '-';
}

/** Render a client's "Зв'язок" field as a clickable link only for recognizably safe schemes. */
export function contactLinkHtml(item) {
  const raw = (item.contactLink || '').trim();
  if (!raw) return '-';
  const safeHref = /^https?:\/\//i.test(raw) ? raw : (/^t\.me\//i.test(raw) ? `https://${raw}` : null);
  return safeHref
    ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(raw)}</a>`
    : escapeHtml(raw);
}

/** Render the KEP-expiry countdown as a colored pill (or em dash if no date set). */
export function kepStatusLabel(dateStr) {
  const diff = daysUntil(dateStr);
  if (diff === null) return '-';
  if (diff < 0) return `<span class="pill late">${Math.abs(diff)} дн.</span>`;
  if (diff === 0) return `<span class="pill ok">0 дн.</span>`;
  if (diff <= 30) return `<span class="pill ok">${diff} дн.</span>`;
  return `<span class="pill ok">${diff} дн.</span>`;
}

export const findClientById = (db, id) => db.clients.find((item) => item.id === id);
export const findClientByName = (db, name) => {
  const normalized = name.trim().toLowerCase();
  return db.clients.find((item) => item.name?.trim().toLowerCase() === normalized);
};
export const visibleClients = (db) => db.clients.filter((item) => lifecycleOf(item) === 'active');
export const archivedClients = (db) => db.clients.filter((item) => lifecycleOf(item) === 'inactive');

export function lifecycleOf(item) {
  if (item.lifecycleStatus === 'deleted') return 'deleted';
  if (item.lifecycleStatus === 'inactive' || item.archived) return 'inactive';
  return 'active';
}

/** Use compact name outside client cards, while keeping the original full name in data. */
export function shortClientName(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).join(' ');
}

export const deletedClients = (db) => db.clients.filter((item) => lifecycleOf(item) === 'deleted');

export function setLifecycleStatus(db, id, status, reason = '') {
  const item = findClientById(db, id);
  if (!item) return null;
  item.lifecycleStatus = status;
  item.archived = status !== 'active';
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

export function requestDeletion(db, id, reason) {
  const item = findClientById(db, id);
  if (!item || lifecycleOf(item) !== 'inactive' || !reason.trim()) return null;
  const eligible = new Date(`${todayIso()}T00:00:00`);
  eligible.setDate(eligible.getDate() + 30);
  item.inactiveReason = reason.trim();
  item.deletionRequestedAt = todayIso();
  item.deletionEligibleAt = eligible.toISOString().slice(0, 10);
  return item;
}

export function advanceScheduledDeletions(db) {
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

/**
 * Create or update a client from validated form field values.
 * Initializes db.monthlyPayments for brand-new clients.
 * @returns {{ record: object, isNew: boolean }}
 */
export function upsertClient(db, fields, existingId) {
  const existing = existingId ? findClientById(db, existingId) : null;
  const record = { ...(existing || {}), ...fields, id: existingId || generateId(), form: 'ФОП' };
  if (existing) {
    Object.assign(existing, record);
    return { record: existing, isNew: false };
  }
  db.clients.push(record);
  db.monthlyPayments[record.id] = {};
  return { record, isNew: true };
}

export function setArchived(db, id, archived) {
  const item = findClientById(db, id);
  if (!item) return null;
  item.archived = archived;
  return item;
}

/** Permanently delete a client and every piece of data keyed by their id. */
export function deleteClient(db, id) {
  const existed = findClientById(db, id);
  if (!existed) return false;
  db.clients = db.clients.filter((item) => item.id !== id);
  delete db.monthlyPayments[id];
  Object.keys(db.taxRecords).forEach((key) => {
    if (key.startsWith(`${id}|`)) delete db.taxRecords[key];
  });
  return true;
}

/** Move a client to a new position in the shared clients array (drag-and-drop reordering). */
export function reorderClients(db, sourceId, targetId) {
  const fromIndex = db.clients.findIndex((item) => item.id === sourceId);
  const toIndex = db.clients.findIndex((item) => item.id === targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return false;
  const [moved] = db.clients.splice(fromIndex, 1);
  db.clients.splice(toIndex, 0, moved);
  return true;
}
