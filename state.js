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
let lastSnapshot = null;
const undoStack = [];
const snapshot = (value) => JSON.stringify(value);
let currentAuditActor = 'Локальний користувач';
let currentAccessRole = 'observer';

/** The signed-in email is supplied by bootstrap; offline work remains attributable locally. */
export function setAuditActor(actor = '') { currentAuditActor = String(actor || '').trim() || 'Локальний користувач'; }
export function setAccessRole(role = 'observer') { currentAccessRole = ['administrator', 'accountant', 'observer'].includes(role) ? role : 'observer'; }
export function canEditData() { return currentAccessRole === 'administrator' || currentAccessRole === 'accountant'; }

/** Called once by bootstrap.js before the first render. */
export async function initDatabase() {
  db = await storage.loadDatabase();
  const normalizedNestedIds = normalizeNestedRecordIds(db);
  const suppressedAuditNoise = suppressTechnicalEmployeeAuditNoise(db.auditEvents || []);
  lastSnapshot = snapshot(db);
  if (normalizedNestedIds || suppressedAuditNoise) storage.scheduleSave(db);
  if (clientModel.advanceScheduledDeletions(db)) save();
  return db;
}

/** Refresh the in-memory UI snapshot after a remote pull; local mutations remain repository-owned. */
export async function refreshDatabaseFromSync() {
  db = await storage.reloadDatabase();
  lastSnapshot = snapshot(db); undoStack.length = 0;
  return db;
}

/** Flush any pending debounced write immediately (call before page unload / destructive ops). */
export async function flushPendingSave() {
  await storage.flushSave();
}

function save(action = 'Зміна даних', type = 'Зміна') {
  if (!canEditData()) {
    if (lastSnapshot) db = JSON.parse(lastSnapshot);
    window.dispatchEvent(new CustomEvent('harmony:access-denied'));
    return false;
  }
  const before = lastSnapshot ? JSON.parse(lastSnapshot) : null;
  const beforeBusiness = before ? businessSnapshot(before) : null;
  const afterBusiness = businessSnapshot(db);
  if (beforeBusiness && JSON.stringify(beforeBusiness) !== JSON.stringify(afterBusiness)) {
    db.auditOperations ||= []; db.auditEvents ||= [];
    const id = generateId(); const occurredAt = new Date().toISOString();
    const operation = { id, occurredAt, action, actor: currentAuditActor, status: 'active', beforeSnapshot: beforeBusiness };
    db.auditOperations.push(operation);
    const events = buildAuditEvents(beforeBusiness, afterBusiness, { operationId: id, occurredAt, actor: operation.actor, type, description: action });
    db.auditEvents.push(...events);
  }
  const next = snapshot(db);
  if (lastSnapshot && next !== lastSnapshot) { undoStack.push(lastSnapshot); if (undoStack.length > 20) undoStack.shift(); }
  lastSnapshot = next;
  storage.scheduleSave(db);
  return true;
}

function businessSnapshot(value) {
  const { auditOperations, auditEvents, ...business } = JSON.parse(JSON.stringify(value));
  return business;
}

/** Give card subrecords stable local IDs before any audit snapshot is taken. */
function normalizeNestedRecordIds(database) {
  let changed = false;
  database.clients.forEach((client) => {
    ['employees', 'accounts', 'kvedAdditional'].forEach((field) => {
      if (!Array.isArray(client[field])) return;
      client[field] = client[field].map((item) => {
        if (item?.id) return item;
        changed = true;
        return { ...item, id: generateId() };
      });
    });
  });
  return changed;
}

const SECTION_NAMES = {
  clients: 'Картки клієнтів', customColumns: 'Картки клієнтів', monthlyPayments: 'Оплати',
  taxRecords: 'Податки', incomeRecords: 'Доходи', reportRecords: 'Звітність',
  calendarEvents: 'Календар', hrOrders: 'Кадри', hrMonthlyDocuments: 'Кадри',
  payrollRecords: 'Виплата зарплати', settings: 'Налаштування',
};
const FIELD_NAMES = {
  name: 'ПІБ', group: 'Група', rate: 'Ставка', phone: 'Телефон', email: 'Ел. пошта',
  status: 'Статус', note: 'Примітка', amount: 'Сума', paid: 'Сплачено', charged: 'Нараховано',
  paymentDate: 'Дата виплати', paymentType: 'Тип виплати', pdfo: 'ПДФО', vz: 'ВЗ', esv: 'ЄСВ',
  title: 'Назва', eventDate: 'Дата події', eventTime: 'Час події', subject: 'Суть документа',
  deliveryStatus: 'Статус надсилання', deadline: 'Дедлайн', submittedDate: 'Дата подання',
  employees: 'Працівники', position: 'Посада',
};

function leafValues(value, path = [], result = new Map()) {
  if (value === null || typeof value !== 'object') { result.set(path.join('.'), value); return result; }
  if (Array.isArray(value)) {
    if (!value.length) { result.set(path.join('.'), value); return result; }
    value.forEach((item, index) => leafValues(item, [...path, String(item?.id || index)], result));
    return result;
  }
  const entries = Object.entries(value);
  if (!entries.length) { result.set(path.join('.'), value); return result; }
  entries.forEach(([key, item]) => leafValues(item, [...path, key], result));
  return result;
}

function auditValue(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'object') return Array.isArray(value) && !value.length ? '-' : JSON.stringify(value);
  return String(value);
}

function auditClientId(root, path, before, after) {
  const key = path[1] || '';
  if (root === 'clients' || root === 'monthlyPayments' || root === 'incomeRecords') return key;
  if (root === 'taxRecords' || root === 'reportRecords' || root === 'hrMonthlyDocuments') return String(key).split('|')[0];
  if (['calendarEvents', 'hrOrders', 'payrollRecords'].includes(root)) {
    const record = (after[root] || []).find((item) => item.id === key) || (before[root] || []).find((item) => item.id === key);
    return record?.clientId || '';
  }
  return '';
}

function auditField(root, path) {
  const relevant = root === 'settings' ? path.slice(1) : path.slice(2);
  const labels = relevant.filter((part) => !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(part)).map((part) => FIELD_NAMES[part] || part.replace(/([A-Z])/g, ' $1').trim());
  return labels.join(' → ') || 'Значення';
}

function buildAuditEvents(before, after, metadata) {
  const oldValues = leafValues(before);
  const newValues = leafValues(after);
  const paths = new Set([...oldValues.keys(), ...newValues.keys()]);
  const clients = new Map([...(before.clients || []), ...(after.clients || [])].map((client) => [client.id, client.name]));
  const events = [];
  paths.forEach((key) => {
    const oldValue = oldValues.get(key); const newValue = newValues.get(key);
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
    if (auditValue(oldValue) === auditValue(newValue)) return;
    const path = key.split('.'); const root = path[0];
    if (!SECTION_NAMES[root]) return;
    if (path[path.length - 1] === 'id') return; // Internal IDs are not user actions.
    const clientId = auditClientId(root, path, before, after);
    events.push({
      id: generateId(), ...metadata, section: SECTION_NAMES[root], clientId: clientId || '', clientName: clientId ? clients.get(clientId) || '-' : '-',
      field: auditField(root, path), oldValue: auditValue(oldValue), newValue: auditValue(newValue), status: 'active',
    });
  });
  return events.length ? events : [{ id: generateId(), ...metadata, section: '-', clientId: '', clientName: '-', field: '-', oldValue: '-', newValue: '-', status: 'active' }];
}

/** Cancels only legacy noise caused by old card saves recreating employee IDs. */
function suppressTechnicalEmployeeAuditNoise(events) {
  let changed = false;
  const groups = new Map();
  events.filter((item) => item.status === 'active' && item.section === 'Картки клієнтів' && String(item.field || '').startsWith('employees → ')).forEach((item) => {
    const key = `${item.operationId}|${item.clientId || ''}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(item);
  });
  groups.forEach((items) => {
    items.filter((item) => /→ id$/i.test(item.field)).forEach((item) => { item.status = 'cancelled'; changed = true; });
    const paired = new Set();
    const userFields = items.filter((item) => !/→ id$/i.test(item.field));
    userFields.forEach((item) => {
      if (paired.has(item) || item.oldValue === '-' || item.newValue !== '-') return;
      const suffix = item.field.replace(/^[^→]+ → [^→]+ → /, '');
      const partner = userFields.find((candidate) => !paired.has(candidate) && candidate !== item
        && candidate.field.replace(/^[^→]+ → [^→]+ → /, '') === suffix
        && candidate.oldValue === '-' && candidate.newValue === item.oldValue);
      if (!partner) return;
      item.status = 'cancelled'; partner.status = 'cancelled'; paired.add(item); paired.add(partner); changed = true;
    });
  });
  return changed;
}

export const getAuditEvents = () => {
  if (suppressTechnicalEmployeeAuditNoise(db.auditEvents || [])) storage.scheduleSave(db);
  return db.auditEvents || [];
};
export const getAuditOperations = () => db.auditOperations || [];

/** Restores all business data to the state immediately before the first active operation after cutoff. */
export function rollbackChangesAfter(cutoff) {
  if (!canEditData()) return 0;
  const operations = getAuditOperations().filter((item) => item.status === 'active' && item.occurredAt > cutoff && item.beforeSnapshot).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (!operations.length) return 0;
  const target = operations[0].beforeSnapshot;
  const auditOperations = db.auditOperations; const auditEvents = db.auditEvents;
  Object.assign(db, JSON.parse(JSON.stringify(target)));
  db.auditOperations = auditOperations; db.auditEvents = auditEvents;
  const rollbackId = generateId(); const now = new Date().toISOString();
  const ids = new Set(operations.map((item) => item.id));
  db.auditOperations.forEach((item) => { if (ids.has(item.id)) Object.assign(item, { status: 'cancelled', cancelledAt: now, cancelledBy: rollbackId }); });
  db.auditEvents.forEach((item) => { if (ids.has(item.operationId)) item.status = 'cancelled'; });
  db.auditOperations.push({ id: rollbackId, occurredAt: now, action: 'Відкат змін', actor: currentAuditActor, status: 'rollback' });
  db.auditEvents.push({ id: generateId(), operationId: rollbackId, occurredAt: now, actor: currentAuditActor, type: 'Відкат', description: `Скасовано операцій: ${operations.length}`, section: 'Журнал подій', clientId: '', clientName: '-', field: '-', oldValue: '-', newValue: '-', status: 'active' });
  lastSnapshot = snapshot(db); undoStack.length = 0; storage.scheduleSave(db);
  return operations.length;
}

export function undoLastAction() {
  if (!canEditData()) return false;
  const previous = undoStack.pop();
  if (!previous) return false;
  db = JSON.parse(previous);
  lastSnapshot = previous;
  storage.scheduleSave(db);
  return true;
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
  save(existingId ? 'Змінено картку ФОП' : 'Створено ФОП', existingId ? 'ФОП' : 'Створення');
  return result;
}

export function setClientLifecycle(id, status, reason = '') {
  const item = clientModel.setLifecycleStatus(db, id, status, reason);
  if (item) save(status === 'inactive' ? 'Перенесено ФОП до неактивних' : 'Відновлено ФОП', 'Статус ФОП');
  return item;
}

export function archiveClient(id, archived, reason = '') {
  return setClientLifecycle(id, archived ? 'inactive' : 'active', reason);
}

export function requestClientDeletion(id, reason) {
  const item = clientModel.requestDeletion(db, id, reason);
  if (item) save('Подано запит на видалення ФОП', 'Видалення');
  return item;
}

export async function deleteClientPermanently(id) {
  const item = clientModel.findClientById(db, id);
  if (!item?.isTestRecord || clientModel.lifecycleOf(item) !== 'deleted') return false;
  const removed = clientModel.deleteClient(db, id);
  if (removed) { save('Остаточно стерто тестовий ФОП', 'Видалення'); await storage.flushSave(); }
  return removed;
}

export function reorderClients(sourceId, targetId) {
  const moved = clientModel.reorderClients(db, sourceId, targetId);
  if (moved) save('Змінено порядок карток ФОП', 'Порядок');
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

export const getCalendarEvents = () => db.calendarEvents;

export function saveCalendarEvent(fields, id = null) {
  const event = { id: id || generateId(), kind: 'note', ...fields };
  const index = db.calendarEvents.findIndex((item) => item.id === event.id);
  if (index >= 0) db.calendarEvents[index] = event;
  else db.calendarEvents.push(event);
  save(id ? 'Змінено задачу' : 'Створено задачу', 'Задача');
  return event;
}

// ---------------------------------------------------------------------------
// HR: employees are kept in a client card; orders are a separate register.
// ---------------------------------------------------------------------------
export const getHrOrders = () => db.hrOrders || [];

export function saveHrOrder(fields, id = null) {
  const order = { id: id || generateId(), ...fields };
  const index = db.hrOrders.findIndex((item) => item.id === order.id);
  if (index >= 0) db.hrOrders[index] = order;
  else db.hrOrders.push(order);
  save();
  return order;
}

export function deleteHrOrder(id) {
  const before = db.hrOrders.length;
  db.hrOrders = db.hrOrders.filter((item) => item.id !== id);
  if (db.hrOrders.length !== before) save();
}

export const getHrMonthlyDocuments = () => db.hrMonthlyDocuments || [];

export function setHrMonthlyDocumentStatus(clientId, period, field, value) {
  const id = `${clientId}|${period}`;
  let record = db.hrMonthlyDocuments.find((item) => item.id === id);
  if (!record) {
    record = { id, clientId, period, timesheetStatus: 'Не надіслано', payrollStatus: 'Не надіслано', cashStatementStatus: 'Не надіслано' };
    db.hrMonthlyDocuments.push(record);
  }
  record[field] = value;
  save();
  return record;
}

export const getPayrollRecords = () => db.payrollRecords || [];

export function addPayrollForClient(clientId, period, paymentType = '') {
  const client = getClientById(clientId);
  if (!client) return 0;
  const employees = client.employees || [];
  let added = 0;
  employees.forEach((employee) => {
    db.payrollRecords.push({ id: generateId(), clientId, employeeId: employee.id, employeeName: employee.name || '', period, paymentType, status: 'Набрано', amount: '', pdfo: '', vz: '', esv: '' });
    added += 1;
  });
  if (added) save();
  return added;
}

export function addPayrollEmployee(clientId, employeeId, period, paymentType = '') {
  const employee = getClientById(clientId)?.employees?.find((item) => item.id === employeeId);
  if (!employee) return null;
  const record = { id: generateId(), clientId, employeeId, employeeName: employee.name || '', period, paymentType, status: 'Набрано', amount: '', pdfo: '', vz: '', esv: '' };
  db.payrollRecords.push(record); save(); return record;
}

export function deletePayrollRecord(id) {
  const before = db.payrollRecords.length;
  db.payrollRecords = db.payrollRecords.filter((item) => item.id !== id);
  if (db.payrollRecords.length !== before) save();
}

export function setPayrollField(id, field, value) {
  const record = db.payrollRecords.find((item) => item.id === id);
  if (!record) return;
  const numeric = ['amount', 'pdfo', 'vz', 'esv'].includes(field);
  const normalized = numeric ? String(value).replace(/\s+/g, '').replace(',', '.') : value;
  if (numeric && normalized && !Number.isFinite(Number(normalized))) return;
  const formatted = numeric && normalized ? new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(Number(normalized)).replace(/\u00a0/g, ' ') : normalized;
  if (field === 'paymentDate') {
    db.payrollRecords.filter((item) => item.clientId === record.clientId && item.period === record.period && (item.paymentType || '') === (record.paymentType || '')).forEach((item) => { item.paymentDate = value; });
  } else record[field] = formatted;
  save();
}

export function deleteCalendarEvent(id) {
  const before = db.calendarEvents.length;
  db.calendarEvents = db.calendarEvents.filter((item) => item.id !== id);
  if (db.calendarEvents.length !== before) save();
}

/** Позначає одну записку або одну дату повторюваної записки як виконану. */
export function toggleCalendarTask(id, occurrenceDate = '') {
  const event = db.calendarEvents.find((item) => item.id === id);
  if (!event) return null;
  const occurrenceKey = event.recurrence?.frequency ? occurrenceDate : '';
  const completed = occurrenceKey ? !(event.completedDates || []).includes(occurrenceKey) : !event.completedAt;
  setTaskCompleted(event, occurrenceKey, completed);
  (event.subtasks || []).forEach((subtask) => setTaskCompleted(subtask, occurrenceKey, completed));
  save();
  return event;
}

function setTaskCompleted(item, occurrenceDate, completed) {
  if (occurrenceDate) {
    const dates = new Set(item.completedDates || []);
    if (completed) dates.add(occurrenceDate); else dates.delete(occurrenceDate);
    item.completedDates = [...dates].sort();
  } else item.completedAt = completed ? new Date().toISOString() : '';
}

function taskIsCompleted(item, occurrenceDate) {
  return occurrenceDate ? (item.completedDates || []).includes(occurrenceDate) : Boolean(item.completedAt);
}

export function addCalendarSubtask(eventId, title, occurrenceDate = '') {
  const event = db.calendarEvents.find((item) => item.id === eventId);
  if (!event || !title?.trim()) return null;
  const subtask = { id: generateId(), title: title.trim(), completedAt: '', completedDates: [] };
  const occurrenceKey = event.recurrence?.frequency ? occurrenceDate : '';
  if (taskIsCompleted(event, occurrenceKey)) setTaskCompleted(subtask, occurrenceKey, true);
  event.subtasks ||= [];
  event.subtasks.push(subtask);
  save();
  return subtask;
}

export function toggleCalendarSubtask(eventId, subtaskId, occurrenceDate = '') {
  const event = db.calendarEvents.find((item) => item.id === eventId);
  const subtask = event?.subtasks?.find((item) => item.id === subtaskId);
  if (!event || !subtask) return null;
  const occurrenceKey = event.recurrence?.frequency ? occurrenceDate : '';
  setTaskCompleted(subtask, occurrenceKey, !taskIsCompleted(subtask, occurrenceKey));
  const allCompleted = event.subtasks.length > 0 && event.subtasks.every((item) => taskIsCompleted(item, occurrenceKey));
  setTaskCompleted(event, occurrenceKey, allCompleted);
  save();
  return subtask;
}

export function deleteCalendarSubtask(eventId, subtaskId) {
  const event = db.calendarEvents.find((item) => item.id === eventId);
  if (!event?.subtasks) return false;
  const before = event.subtasks.length;
  event.subtasks = event.subtasks.filter((item) => item.id !== subtaskId);
  if (event.subtasks.length === before) return false;
  save();
  return true;
}

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

export function setAppearanceSetting(key, value) {
  db.settings.appearance ||= { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 };
  db.settings.appearance[key] = value;
  save();
}

// ---------------------------------------------------------------------------
// Bulk import / full-database restore
// ---------------------------------------------------------------------------

/** Replace the entire in-memory database (used by "restore from backup file"). */
export async function replaceDatabase(newDb) {
  if (currentAccessRole !== 'administrator') throw new Error('Відновлення резервної копії доступне лише адміністратору.');
  if (!newDb || typeof newDb !== 'object' || !Array.isArray(newDb.clients) || !newDb.settings || typeof newDb.settings !== 'object') {
    throw new Error('Файл не схожий на повну резервну копію Harmony.');
  }
  // Persist first, then reload through the repository normalizer. This keeps
  // old, valid backups compatible when newer optional collections are added.
  await storage.saveNow(newDb);
  db = await storage.reloadDatabase();
  lastSnapshot = snapshot(db); undoStack.length = 0;
  return db;
}
