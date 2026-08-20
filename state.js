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
import { getTaxRecord, effectiveDeadline as effectiveTaxDeadline, getDefaultDeadline as getDefaultTaxDeadline, exemptionOptions } from './tax-model.ts';
import { getReportRecord, effectiveReportDeadline } from './report-model.ts';
import { toNumber, generateId } from './utils';
import { normalizeNonNegativeAmount } from './money-validation.js';
import { validateHrOrder } from './hr-order-model.js';
import { isValidMonthPeriodKey, isValidOptionalIsoDate, isValidReportPeriodKey, isValidTaxPeriodKey, validateCalendarEvent, validateReportRecordChange, validateTaxRecordChange } from './workflow-validation.js';
import { validateBackupDatabase } from './backup-crypto.js';
import { collectDatabaseRelationshipIssues } from './data/database-validation.js';
import { validateCustomColumn } from './validation.js';
import { payrollDateForPaymentType } from './payroll-model.js';
import { normalizeEmployeeName, validateEmployee } from './employee-model.js';

export let db = null;
let lastSnapshot = null;
let lastBusinessSnapshot = null;
const undoStack = [];
const MAX_UNDO_SNAPSHOTS = 5;
const cloneValue = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const valuesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
let currentAuditActor = 'Локальний користувач';
let currentAccessRole = 'observer';
const ROLLBACK_RETENTION_DAYS = 7;

/** The signed-in email is supplied by bootstrap; offline work remains attributable locally. */
export function setAuditActor(actor = '') { currentAuditActor = String(actor || '').trim() || 'Локальний користувач'; }
export function setAccessRole(role = 'observer') { currentAccessRole = ['administrator', 'accountant', 'observer'].includes(role) ? role : 'observer'; }
export function canEditData() { return currentAccessRole === 'administrator' || currentAccessRole === 'accountant'; }
export function canRollbackChanges() { return currentAccessRole === 'administrator'; }
export function rollbackRetentionStart() { return new Date(Date.now() - ROLLBACK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(); }

function pruneExpiredRollbackSnapshots(database) {
  const cutoff = rollbackRetentionStart();
  let changed = false;
  (database.auditOperations || []).forEach((operation) => {
    if (operation.beforeSnapshot && String(operation.occurredAt || '') < cutoff) { delete operation.beforeSnapshot; changed = true; }
  });
  return changed;
}

function normalizeLegacyTaxExemptions(database) {
  let changed = false;
  Object.values(database.taxRecords || {}).forEach((record) => {
    if (record?.exemption === 'ТМБД') { record.exemption = 'Т(М)БД'; changed = true; }
  });
  return changed;
}

/** Called once by bootstrap.js before the first render. */
export async function initDatabase(workspaceId = null) {
  db = await storage.loadDatabase(workspaceId);
  const normalizedNestedIds = normalizeNestedRecordIds(db);
  const normalizedAuditLabels = normalizeAuditFieldLabels(db.auditEvents || []);
  const suppressedAuditNoise = suppressTechnicalNestedAuditNoise(db.auditEvents || []);
  const prunedRollbackSnapshots = pruneExpiredRollbackSnapshots(db);
  const normalizedTaxExemptions = normalizeLegacyTaxExemptions(db);
  lastSnapshot = cloneValue(db); lastBusinessSnapshot = businessSnapshot(db); undoStack.length = 0;
  if (normalizedNestedIds || normalizedAuditLabels || suppressedAuditNoise || prunedRollbackSnapshots || normalizedTaxExemptions) storage.scheduleSave(db);
  if (clientModel.advanceScheduledDeletions(db)) save();
  return db;
}

/** Refresh the in-memory UI snapshot after a remote pull; local mutations remain repository-owned. */
export async function refreshDatabaseFromSync() {
  db = await storage.reloadDatabase();
  lastSnapshot = cloneValue(db); lastBusinessSnapshot = businessSnapshot(db); undoStack.length = 0;
  return db;
}

/** Flush any pending debounced write immediately (call before page unload / destructive ops). */
export async function flushPendingSave() {
  await storage.flushSave();
}

export async function prepareDatabaseSwitch() { await storage.prepareWorkspaceSwitch(); }
export function resumeDatabaseSync() { storage.resumeWorkspaceSync(); }

/** Remove every in-memory reference to private workspace data after logout. */
export async function lockDatabase() {
  try {
    await storage.closeDatabase();
  } finally {
    db = null;
    lastSnapshot = null;
    lastBusinessSnapshot = null;
    undoStack.length = 0;
    currentAuditActor = 'Локальний користувач';
    currentAccessRole = 'observer';
  }
}

function save(action = 'Зміна даних', type = 'Зміна') {
  if (!canEditData()) {
    if (lastSnapshot) db = cloneValue(lastSnapshot);
    window.dispatchEvent(new CustomEvent('harmony:access-denied'));
    return false;
  }
  const afterBusiness = businessSnapshot(db);
  if (lastBusinessSnapshot && !valuesEqual(afterBusiness, lastBusinessSnapshot)) {
    const beforeBusiness = cloneValue(lastBusinessSnapshot);
    db.auditOperations ||= []; db.auditEvents ||= [];
    const id = generateId(); const occurredAt = new Date().toISOString();
    const operation = { id, occurredAt, action, actor: currentAuditActor, status: 'active', beforeSnapshot: beforeBusiness };
    db.auditOperations.push(operation);
    const events = buildAuditEvents(beforeBusiness, afterBusiness, { operationId: id, occurredAt, actor: operation.actor, type, description: action });
    db.auditEvents.push(...events);
  }
  pruneExpiredRollbackSnapshots(db);
  const next = cloneValue(db);
  if (lastSnapshot && !valuesEqual(next, lastSnapshot)) { undoStack.push({ kind: 'snapshot', value: lastSnapshot }); if (undoStack.length > MAX_UNDO_SNAPSHOTS) undoStack.shift(); }
  lastSnapshot = next;
  lastBusinessSnapshot = afterBusiness;
  storage.scheduleSave(db);
  return true;
}

function businessSnapshot(value) {
  const { auditOperations, auditEvents, ...business } = value;
  return cloneValue(business);
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
  name: 'ПІБ', group: 'Група', rate: 'Ставка', phone: 'Телефон', email: 'Email',
  status: 'Статус', note: 'Примітка', amount: 'Сума', paid: 'Сплачено', charged: 'Нараховано',
  paymentDate: 'Дата виплати', paymentType: 'Тип виплати', pdfo: 'ПДФО', vz: 'ВЗ', esv: 'ЄСВ',
  title: 'Назва', eventDate: 'Дата події', eventTime: 'Час події', subject: 'Суть документа',
  deliveryStatus: 'Статус надсилання', deadline: 'Дедлайн', submittedDate: 'Дата подання',
  employees: 'Працівники', employeeId: 'Працівник', employeeName: 'ПІБ працівника', position: 'Посада', hireDate: 'Дата прийняття', dismissalDate: 'Дата звільнення', rnokpp: 'РНОКПП', source: 'Джерело', form: 'Форма',
  currency: 'Валюта', bankAccess: 'Банк', banks: 'Банки', prro: 'П/РРО', prroName: 'Назва П/РРО',
  employeesCount: 'Кількість найманих', serviceCost: 'Вартість', kepIssuer: 'КЕП від:', kepValidFrom: 'КЕП дійсний з', kepExpiry: 'Дійсний',
  registrationAddress: 'Адреса реєстрації', taxOffice: 'ДПІ', additionalInfo: 'Додаткова інформація',
  kvedMainCode: 'Основний код КВЕД', kvedMainName: 'Назва основного КВЕД', kvedAdditional: 'Додаткові КВЕД',
  code: 'Код КВЕД', accounts: 'Рахунки', iban: 'IBAN', bankName: 'Банк / Установа', openDate: 'Дата відкриття',
  pricingBase: 'Базова вартість', pricingStaff: 'Доплата за працівників', pricingPrro: 'Доплата за П/РРО',
  queuedDate: 'Набрано в банку', paidDate: 'Дата сплати', exemption: 'Причина звільнення',
  timesheetStatus: 'Табель робочого часу', payrollStatus: 'Розрахунково-платіжна відомість', cashStatementStatus: 'Відомість на виплату готівки',
  date: 'Дата документа', effectiveDate: 'Дата початку дії', number: 'Номер документа', employeeName: 'ПІБ працівника',
  completedAt: 'Виконано', completedDates: 'Дати виконання', subtasks: 'Підзадачі', customFields: 'Додаткові поля',
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

const LEGACY_AUDIT_FIELD_NAMES = new Map(Object.entries(FIELD_NAMES).flatMap(([key, label]) => [
  [key, label],
  [key.replace(/([A-Z])/g, ' $1').trim(), label],
]));

function normalizeAuditFieldLabels(events) {
  let changed = false;
  events.forEach((item) => {
    if (!item.field || item.field === '-') return;
    const normalized = String(item.field).split(' → ').map((part) => LEGACY_AUDIT_FIELD_NAMES.get(part) || part).join(' → ');
    if (normalized !== item.field) { item.field = normalized; changed = true; }
  });
  return changed;
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

function applyPathValue(database, change, direction = 'after') {
  const path = change.path || [];
  if (!database || path.length < 2) return;
  let target = database;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (Array.isArray(target)) {
      target = target.find((item) => item?.id === key);
      if (!target) return;
    } else {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
  }
  const key = path.at(-1);
  const existed = direction === 'after' ? change.afterExisted !== false : change.beforeExisted !== false;
  const value = direction === 'after' ? change.after : change.before;
  if (Array.isArray(target)) return;
  if (!existed) delete target[key];
  else target[key] = cloneValue(value);
}

function mutationForPath(database, path) {
  const [root, first, second] = path;
  if (root === 'clients') {
    const record = database.clients.find((item) => item.id === first);
    return record ? { table: 'clients', id: first, payload: cloneValue(record) } : { table: 'clients', id: first, deleted: true };
  }
  if (root === 'monthlyPayments') return { table: 'monthly_payments', id: `${first}|${second}`, payload: { clientId: first, monthKey: second, value: cloneValue(database.monthlyPayments[first]?.[second] || {}) } };
  if (root === 'taxRecords') return { table: 'tax_records', id: first, payload: { key: first, value: cloneValue(database.taxRecords[first] || {}) } };
  if (root === 'incomeRecords') return { table: 'income_records', id: `${first}|${second}`, payload: { clientId: first, monthKey: second, value: database.incomeRecords[first]?.[second] || '' } };
  if (root === 'reportRecords') return { table: 'report_records', id: first, payload: { key: first, value: cloneValue(database.reportRecords[first] || {}) } };
  if (root === 'payrollRecords') {
    const record = database.payrollRecords.find((item) => item.id === first);
    return record ? { table: 'payroll_records', id: first, payload: cloneValue(record) } : { table: 'payroll_records', id: first, deleted: true };
  }
  if (root === 'hrMonthlyDocuments') {
    const record = database.hrMonthlyDocuments.find((item) => item.id === first);
    return record ? { table: 'hr_monthly_documents', id: first, payload: cloneValue(record) } : { table: 'hr_monthly_documents', id: first, deleted: true };
  }
  throw new Error(`Непідтримуваний точковий шлях: ${root}`);
}

function syncBaselineRow(target, source, path) {
  if (!target) return;
  const [root, first, second] = path;
  if (root === 'monthlyPayments') {
    target.monthlyPayments[first] ||= {};
    target.monthlyPayments[first][second] = cloneValue(source.monthlyPayments[first]?.[second] || {});
  } else if (root === 'incomeRecords') {
    target.incomeRecords[first] ||= {};
    target.incomeRecords[first][second] = source.incomeRecords[first]?.[second] || '';
  } else if (['taxRecords', 'reportRecords'].includes(root)) target[root][first] = cloneValue(source[root][first] || {});
  else if (['clients', 'payrollRecords', 'hrMonthlyDocuments'].includes(root)) {
    const sourceRecord = source[root].find((item) => item.id === first);
    const index = target[root].findIndex((item) => item.id === first);
    if (!sourceRecord && index >= 0) target[root].splice(index, 1);
    else if (sourceRecord && index >= 0) target[root][index] = cloneValue(sourceRecord);
    else if (sourceRecord) target[root].push(cloneValue(sourceRecord));
  }
}

function directAuditEvent(change, metadata) {
  const root = change.path[0];
  const clientId = change.clientId || '';
  return {
    id: generateId(), ...metadata, section: SECTION_NAMES[root] || '-', clientId,
    clientName: clientId ? clientModel.findClientById(db, clientId)?.name || '-' : '-',
    field: auditField(root, change.path), oldValue: auditValue(change.before), newValue: auditValue(change.after), status: 'active',
  };
}

/** Fast path for ordinary table cells. It records exact inverse changes for
 * undo/rollback and queues only the affected SQLite rows. No whole-database
 * clone, stringify or recursive audit diff runs on the input event. */
function saveTargetedChanges(rawChanges, action, type) {
  const changes = rawChanges.filter((change) => !valuesEqual(change.before, change.after) || change.beforeExisted !== change.afterExisted);
  if (!changes.length) return true;
  const operationId = generateId();
  const occurredAt = new Date().toISOString();
  const inverseChanges = changes.map((change) => ({ path: [...change.path], value: cloneValue(change.before), existed: change.beforeExisted !== false }));
  const operation = { id: operationId, occurredAt, action, actor: currentAuditActor, status: 'active', inverseChanges };
  const metadata = { operationId, occurredAt, actor: operation.actor, type, description: action };
  const events = changes.map((change) => directAuditEvent(change, metadata));
  db.auditOperations ||= [];
  db.auditEvents ||= [];
  db.auditOperations.push(operation);
  db.auditEvents.push(...events);

  undoStack.push({ kind: 'mutations', changes: cloneValue(inverseChanges), operationId });
  if (undoStack.length > MAX_UNDO_SNAPSHOTS) undoStack.shift();

  changes.forEach((change) => {
    syncBaselineRow(lastBusinessSnapshot, db, change.path);
    syncBaselineRow(lastSnapshot, db, change.path);
  });
  if (lastSnapshot) {
    lastSnapshot.auditOperations ||= [];
    lastSnapshot.auditEvents ||= [];
    lastSnapshot.auditOperations.push(cloneValue(operation));
    lastSnapshot.auditEvents.push(...cloneValue(events));
  }

  const rowMutations = new Map();
  changes.forEach((change) => {
    const mutation = mutationForPath(db, change.path);
    rowMutations.set(`${mutation.table}|${mutation.id}`, mutation);
  });
  rowMutations.set(`audit_operations|${operation.id}`, { table: 'audit_operations', id: operation.id, payload: cloneValue(operation) });
  events.forEach((event) => rowMutations.set(`audit_events|${event.id}`, { table: 'audit_events', id: event.id, payload: cloneValue(event) }));
  storage.scheduleMutations([...rowMutations.values()]);
  return true;
}

/** Cancels legacy delete/add pairs caused only by old card saves recreating nested IDs. */
function suppressTechnicalNestedAuditNoise(events) {
  let changed = false;
  ['Працівники → ', 'employees → ', 'Додаткові КВЕД → ', 'kved Additional → ', 'kvedAdditional → '].forEach((prefix) => {
    const groups = new Map();
    events.filter((item) => item.status === 'active' && item.section === 'Картки клієнтів' && String(item.field || '').startsWith(prefix)).forEach((item) => {
      const key = `${item.operationId}|${item.clientId || ''}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(item);
    });
    groups.forEach((items) => {
      const removed = items.filter((item) => item.oldValue !== '-' && item.newValue === '-');
      const added = items.filter((item) => item.oldValue === '-' && item.newValue !== '-');
      const paired = new Set();
      removed.forEach((item) => {
        const field = String(item.field).split(' → ').at(-1);
        const partner = added.find((candidate) => !paired.has(candidate)
          && String(candidate.field).split(' → ').at(-1) === field && candidate.newValue === item.oldValue);
        if (!partner) return;
        item.status = 'cancelled'; partner.status = 'cancelled'; paired.add(partner); changed = true;
      });
    });
  });
  return changed;
}

export const getAuditEvents = () => {
  const events = db.auditEvents || [];
  const labelsChanged = normalizeAuditFieldLabels(events);
  const noiseChanged = suppressTechnicalNestedAuditNoise(events);
  if (labelsChanged || noiseChanged) storage.scheduleSave(db);
  return events;
};
export const getAuditOperations = () => db.auditOperations || [];
export const getDatabaseRelationshipIssues = () => collectDatabaseRelationshipIssues(db);

/** Restores all business data to the state immediately before the first active operation after cutoff. */
export function rollbackChangesAfter(cutoff) {
  if (!canRollbackChanges()) return 0;
  const effectiveCutoff = String(cutoff || '') > rollbackRetentionStart() ? String(cutoff) : rollbackRetentionStart();
  const operations = getAuditOperations()
    .filter((item) => item.status === 'active' && item.occurredAt > effectiveCutoff && (item.beforeSnapshot || item.inverseChanges?.length))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  if (!operations.length) return 0;
  const auditOperations = db.auditOperations; const auditEvents = db.auditEvents;
  operations.forEach((operation) => {
    if (operation.inverseChanges?.length) {
      operation.inverseChanges.forEach((inverse) => applyPathValue(db, { path: inverse.path, after: inverse.value, afterExisted: inverse.existed }, 'after'));
    } else if (operation.beforeSnapshot) Object.assign(db, cloneValue(operation.beforeSnapshot));
  });
  db.auditOperations = auditOperations; db.auditEvents = auditEvents;
  const rollbackId = generateId(); const now = new Date().toISOString();
  const ids = new Set(operations.map((item) => item.id));
  db.auditOperations.forEach((item) => { if (ids.has(item.id)) Object.assign(item, { status: 'cancelled', cancelledAt: now, cancelledBy: rollbackId }); });
  db.auditEvents.forEach((item) => { if (ids.has(item.operationId)) item.status = 'cancelled'; });
  db.auditOperations.push({ id: rollbackId, occurredAt: now, action: 'Відкат змін', actor: currentAuditActor, status: 'rollback' });
  db.auditEvents.push({ id: generateId(), operationId: rollbackId, occurredAt: now, actor: currentAuditActor, type: 'Відкат', description: `Скасовано операцій: ${operations.length}`, section: 'Журнал подій', clientId: '', clientName: '-', field: '-', oldValue: '-', newValue: '-', status: 'active' });
  lastSnapshot = cloneValue(db); lastBusinessSnapshot = businessSnapshot(db); undoStack.length = 0; storage.scheduleSave(db);
  return operations.length;
}

export function undoLastAction() {
  if (!canEditData()) return false;
  const previous = undoStack.pop();
  if (!previous) return false;
  const auditOperations = db.auditOperations ||= [];
  const auditEvents = db.auditEvents ||= [];
  let targetBusiness = null;
  let revertedOperations;
  if (previous.kind === 'mutations') {
    previous.changes.forEach((inverse) => applyPathValue(db, { path: inverse.path, after: inverse.value, afterExisted: inverse.existed }, 'after'));
    revertedOperations = auditOperations.filter((item) => item.status === 'active' && item.id === previous.operationId);
  } else {
    const targetSnapshot = cloneValue(previous.value);
    targetBusiness = businessSnapshot(targetSnapshot);
    const previousOperationIds = new Set((targetSnapshot.auditOperations || []).map((item) => item.id));
    revertedOperations = auditOperations.filter((item) => item.status === 'active' && !previousOperationIds.has(item.id));
  }
  const undoId = generateId();
  const occurredAt = new Date().toISOString();
  const revertedIds = new Set(revertedOperations.map((item) => item.id));
  auditOperations.forEach((item) => {
    if (revertedIds.has(item.id)) Object.assign(item, { status: 'cancelled', cancelledAt: occurredAt, cancelledBy: undoId });
  });
  auditEvents.forEach((item) => {
    if (revertedIds.has(item.operationId)) item.status = 'cancelled';
  });
  const revertedActions = revertedOperations.map((item) => item.action).filter(Boolean);
  auditOperations.push({
    id: undoId,
    occurredAt,
    action: 'Скасовано останню дію',
    actor: currentAuditActor,
    status: 'rollback',
    revertedOperationIds: [...revertedIds],
  });
  auditEvents.push({
    id: generateId(),
    operationId: undoId,
    occurredAt,
    actor: currentAuditActor,
    type: 'Скасування',
    description: revertedActions.length ? `Скасовано: ${revertedActions.join(', ')}` : 'Скасовано останню локальну зміну',
    section: 'Журнал подій',
    clientId: '',
    clientName: '-',
    field: '-',
    oldValue: '-',
    newValue: '-',
    status: 'active',
  });
  if (targetBusiness) db = { ...targetBusiness, auditOperations, auditEvents };
  lastSnapshot = cloneValue(db);
  lastBusinessSnapshot = businessSnapshot(db);
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
export function purgeDeletedTestClients() {
  const ids = db.clients.filter((item) => item.isTestRecord && clientModel.lifecycleOf(item) === 'deleted').map((item) => item.id);
  ids.forEach((id) => clientModel.deleteClient(db, id));
  if (ids.length) save('Очищено тестові ФОП із видалених', 'Видалення');
  return ids.length;
}
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
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return false; }
  const item = clientModel.findClientById(db, clientId);
  if (!item || !db.customColumns.some((column) => column.id === columnId)) return false;
  item.customFields ||= {};
  const change = { path: ['clients', clientId, 'customFields', columnId], clientId, before: cloneValue(item.customFields[columnId]), beforeExisted: Object.prototype.hasOwnProperty.call(item.customFields, columnId), after: value, afterExisted: true };
  item.customFields[columnId] = value;
  saveTargetedChanges([change], 'Змінено додаткове поле ФОП', 'ФОП');
  return true;
}

// ---------------------------------------------------------------------------
// Custom columns (Картки клієнтів)
// ---------------------------------------------------------------------------

export const getCustomColumns = () => db.customColumns;

export function addCustomColumn(fields) {
  if (validateCustomColumn(fields, db.customColumns).errors.length) return null;
  const column = { id: generateId(), name: fields.name.trim(), type: fields.type };
  db.customColumns.push(column);
  save();
  return column;
}

export function updateCustomColumn(id, fields) {
  const column = db.customColumns.find((item) => item.id === id);
  if (!column || validateCustomColumn(fields, db.customColumns, id).errors.length) return null;
  Object.assign(column, { ...fields, name: fields.name.trim() });
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
  const validation = validateCalendarEvent(fields);
  if (!validation.ok) return null;
  const event = { id: id || generateId(), kind: 'note', ...fields };
  const index = db.calendarEvents.findIndex((item) => item.id === event.id);
  if (index >= 0) db.calendarEvents[index] = event;
  else db.calendarEvents.push(event);
  save(id ? 'Змінено задачу' : 'Створено задачу', 'Задача');
  return event;
}

// ---------------------------------------------------------------------------
// HR: employees are stored under their employer client; cards expose them as a dedicated register.
// ---------------------------------------------------------------------------
export function getEmployeeById(id) {
  for (const client of db.clients || []) {
    const employee = (client.employees || []).find((item) => item.id === id);
    if (employee) return { client, employee };
  }
  return null;
}

export function saveEmployee(fields, id = null) {
  const validation = validateEmployee(fields);
  const client = clientModel.findClientById(db, fields?.clientId);
  if (!validation.ok || !client) return null;
  const existing = id ? getEmployeeById(id) : null;
  if (existing && existing.client.id !== client.id) return null;
  const duplicate = (client.employees || []).some((item) => item.id !== id && normalizeEmployeeName(item.name) === normalizeEmployeeName(fields.name));
  if (duplicate) return null;
  const employee = { ...(existing?.employee || {}), id: id || generateId(), name: String(fields.name).trim(), position: String(fields.position).trim(), hireDate: fields.hireDate, dismissalDate: fields.dismissalDate || '', salaryPaymentMethod: fields.salaryPaymentMethod === 'Готівка' ? 'Готівка' : 'Безготівкою' };
  client.employees ||= [];
  const index = client.employees.findIndex((item) => item.id === employee.id);
  if (index >= 0) client.employees[index] = employee;
  else client.employees.push(employee);
  client.employeesCount = String(client.employees.length);
  client.hadEmployees = true;
  (db.hrOrders || []).forEach((order) => {
    const legacyMatch = order.clientId === client.id && !order.employeeId && normalizeEmployeeName(order.employeeName) === normalizeEmployeeName(existing?.employee?.name || employee.name);
    if (order.employeeId === employee.id || legacyMatch) { order.employeeId = employee.id; order.employeeName = employee.name; }
  });
  (db.payrollRecords || []).filter((record) => record.employeeId === employee.id).forEach((record) => { record.employeeName = employee.name; });
  save(id ? 'Змінено картку працівника' : 'Створено картку працівника', 'Кадри');
  return employee;
}

export const getHrOrders = () => db.hrOrders || [];

export function saveHrOrder(fields, id = null) {
  const validation = validateHrOrder(fields, db.hrOrders || [], id);
  if (!validation.ok) return null;
  const client = clientModel.findClientById(db, fields.clientId);
  const linkedEmployee = fields.employeeId
    ? (client?.employees || []).find((employee) => employee.id === fields.employeeId)
    : (client?.employees || []).find((employee) => normalizeEmployeeName(employee.name) === normalizeEmployeeName(fields.employeeName));
  const order = { id: id || generateId(), ...fields, employeeId: linkedEmployee?.id || '', employeeName: linkedEmployee?.name || String(fields.employeeName || '').trim() };
  const index = db.hrOrders.findIndex((item) => item.id === order.id);
  if (index >= 0) db.hrOrders[index] = order;
  else db.hrOrders.push(order);
  save(id ? 'Змінено кадровий документ' : 'Створено кадровий документ', 'Кадри');
  return order;
}

export function deleteHrOrder(id) {
  const before = db.hrOrders.length;
  db.hrOrders = db.hrOrders.filter((item) => item.id !== id);
  const removed = db.hrOrders.length !== before;
  if (removed) save('Видалено кадровий документ', 'Кадри');
  return removed;
}

export const getHrMonthlyDocuments = () => db.hrMonthlyDocuments || [];

export function setHrMonthlyDocumentStatus(clientId, period, field, value) {
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return null; }
  if (!clientModel.findClientById(db, clientId) || !isValidMonthPeriodKey(period)) return null;
  if (!['timesheetStatus', 'payrollStatus', 'cashStatementStatus'].includes(field)) return null;
  if (!['Надіслано', 'Не надіслано'].includes(value)) return null;
  const id = `${clientId}|${period}`;
  let record = db.hrMonthlyDocuments.find((item) => item.id === id);
  const created = !record;
  if (!record) {
    record = { id, clientId, period, timesheetStatus: 'Не надіслано', payrollStatus: 'Не надіслано', cashStatementStatus: 'Не надіслано' };
    db.hrMonthlyDocuments.push(record);
  }
  const change = { path: ['hrMonthlyDocuments', id, field], clientId, before: cloneValue(record[field]), beforeExisted: Object.prototype.hasOwnProperty.call(record, field), after: value, afterExisted: true };
  record[field] = value;
  if (created) save('Створено кадрову відомість', 'Кадри');
  else saveTargetedChanges([change], 'Змінено кадрову відомість', 'Кадри');
  return record;
}

export const getPayrollRecords = () => db.payrollRecords || [];

function isSamePayrollSlot(record, clientId, employeeId, period, paymentType) {
  return record.clientId === clientId
    && record.employeeId === employeeId
    && record.period === period
    && String(record.paymentType || '').trim() === String(paymentType || '').trim();
}

export function addPayrollForClient(clientId, period, paymentType = '') {
  const client = getClientById(clientId);
  if (!client) return 0;
  const employees = client.employees || [];
  let added = 0;
  employees.forEach((employee) => {
    if (db.payrollRecords.some((record) => isSamePayrollSlot(record, clientId, employee.id, period, paymentType))) return;
    db.payrollRecords.push({ id: generateId(), clientId, employeeId: employee.id, employeeName: employee.name || '', period, paymentType: String(paymentType || '').trim(), paymentDate: payrollDateForPaymentType(db.settings, period, paymentType), status: '', amount: '', pdfo: '', vz: '', esv: '' });
    added += 1;
  });
  if (added) save();
  return added;
}

export function addPayrollEmployee(clientId, employeeId, period, paymentType = '') {
  const employee = getClientById(clientId)?.employees?.find((item) => item.id === employeeId);
  if (!employee) return null;
  if (db.payrollRecords.some((record) => isSamePayrollSlot(record, clientId, employeeId, period, paymentType))) return null;
  const record = { id: generateId(), clientId, employeeId, employeeName: employee.name || '', period, paymentType: String(paymentType || '').trim(), paymentDate: payrollDateForPaymentType(db.settings, period, paymentType), status: '', amount: '', pdfo: '', vz: '', esv: '' };
  db.payrollRecords.push(record); save(); return record;
}

export function deletePayrollRecord(id) {
  const before = db.payrollRecords.length;
  db.payrollRecords = db.payrollRecords.filter((item) => item.id !== id);
  const removed = db.payrollRecords.length !== before;
  if (removed) save('Видалено зарплатний рядок', 'Зарплата');
  return removed;
}

export function setPayrollField(id, field, value) {
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return false; }
  const record = db.payrollRecords.find((item) => item.id === id);
  if (!record) return false;
  if (!['paymentDate', 'amount', 'pdfo', 'vz', 'esv', 'status'].includes(field)) return false;
  if (field === 'paymentDate' && !isValidOptionalIsoDate(value)) return false;
  if (field === 'status' && !['', 'Набрано', 'Сплачено', 'Повідомлено', 'Сплачено невчасно'].includes(value)) return false;
  const numeric = ['amount', 'pdfo', 'vz', 'esv'].includes(field);
  const amount = numeric ? normalizeNonNegativeAmount(value) : null;
  if (numeric && !amount.ok) return false;
  const normalized = numeric ? amount.value : value;
  const formatted = numeric && normalized ? new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(Number(normalized)).replace(/\u00a0/g, ' ') : normalized;
  const affected = field === 'paymentDate'
    ? db.payrollRecords.filter((item) => item.clientId === record.clientId && item.period === record.period && (item.paymentType || '') === (record.paymentType || ''))
    : [record];
  const changes = affected.map((item) => ({
    path: ['payrollRecords', item.id, field], clientId: item.clientId,
    before: cloneValue(item[field]), beforeExisted: Object.prototype.hasOwnProperty.call(item, field),
    after: field === 'paymentDate' ? value : formatted, afterExisted: true,
  }));
  affected.forEach((item) => { item[field] = field === 'paymentDate' ? value : formatted; });
  saveTargetedChanges(changes, 'Змінено запис виплати зарплати', 'Зарплата');
  return true;
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
  item.completionUpdatedAt = new Date().toISOString();
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
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return false; }
  if (!clientModel.findClientById(db, clientId) || !isValidMonthPeriodKey(monthKey) || !['charged', 'paid'].includes(type)) return false;
  const amount = normalizeNonNegativeAmount(rawValue, { allowDash: true });
  if (!amount.ok) return false;
  const normalized = amount.value;
  const clientData = db.monthlyPayments[clientId] ||= {};
  const monthData = clientData[monthKey] ||= {};
  const nextValue = normalized === '' ? '-' : normalized;
  const change = { path: ['monthlyPayments', clientId, monthKey, type], clientId, before: cloneValue(monthData[type]), beforeExisted: Object.prototype.hasOwnProperty.call(monthData, type), after: nextValue, afterExisted: true };
  monthData[type] = nextValue;
  saveTargetedChanges([change], 'Змінено оплату послуг', 'Оплати');
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
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return false; }
  const client = clientModel.findClientById(db, clientId);
  if (!client || String(client.group) !== String(realGroup) || !isValidTaxPeriodKey(realGroup, period) || !['unified', 'military', 'esv'].includes(taxType)) return false;
  const record = getTaxRecord(db, clientId, realGroup, period, taxType);
  const validation = validateTaxRecordChange(record, field, value);
  if (!validation.ok) return false;
  if (field === 'exemption' && !exemptionOptions(String(realGroup) === '3' ? '3' : '12', taxType).includes(value)) return false;
  const key = `${clientId}|${realGroup}|${period}|${taxType}`;
  const change = { path: ['taxRecords', key, field], clientId, before: cloneValue(record[field]), beforeExisted: Object.prototype.hasOwnProperty.call(record, field), after: value, afterExisted: true };
  record[field] = value;
  saveTargetedChanges([change], 'Змінено податковий запис', 'Податки');
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
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return 0; }
  const changes = [];
  clientIds.forEach((clientId, i) => {
    taxTypeKeys.forEach((taxType) => {
      const record = getTaxRecord(db, clientId, realGroups[i], period, taxType);
      const key = `${clientId}|${realGroups[i]}|${period}|${taxType}`;
      changes.push({ path: ['taxRecords', key, field], clientId, before: cloneValue(record[field]), beforeExisted: Object.prototype.hasOwnProperty.call(record, field), after: value, afterExisted: true });
      record[field] = value;
    });
  });
  saveTargetedChanges(changes, 'Масово змінено податкові записи', 'Податки');
  return changes.length;
}

/** Carry "deadline"/"exemption" forward from the previous period into empty fields of the current one. Never touches paidDate/queuedDate/note. */
export function copyTaxPeriodForward(clientIds, realGroups, fromPeriod, toPeriod, taxTypeKeys) {
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return 0; }
  let filled = 0;
  const changes = [];
  const carryFields = ['deadline', 'exemption'];
  clientIds.forEach((clientId, i) => {
    taxTypeKeys.forEach((taxType) => {
      const source = getTaxRecord(db, clientId, realGroups[i], fromPeriod, taxType);
      const target = getTaxRecord(db, clientId, realGroups[i], toPeriod, taxType);
      carryFields.forEach((field) => {
        if (!target[field] && source[field]) {
          const key = `${clientId}|${realGroups[i]}|${toPeriod}|${taxType}`;
          changes.push({ path: ['taxRecords', key, field], clientId, before: cloneValue(target[field]), beforeExisted: Object.prototype.hasOwnProperty.call(target, field), after: source[field], afterExisted: true });
          target[field] = source[field]; filled += 1;
        }
      });
    });
  });
  if (filled) saveTargetedChanges(changes, 'Перенесено податкові дані з попереднього періоду', 'Податки');
  return filled;
}

// ---------------------------------------------------------------------------
// Reports (Звітність)
// ---------------------------------------------------------------------------

export function getReportField(clientId, realGroup, period) {
  return getReportRecord(db, clientId, realGroup, period);
}

export function setReportField(clientId, realGroup, period, field, value) {
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return false; }
  const client = clientModel.findClientById(db, clientId);
  if (!client || String(client.group) !== String(realGroup) || !isValidReportPeriodKey(realGroup, period)) return false;
  const record = getReportRecord(db, clientId, realGroup, period);
  const validation = validateReportRecordChange(field, value);
  if (!validation.ok) return false;
  const key = `${clientId}|${realGroup}|${period}`;
  const change = { path: ['reportRecords', key, field], clientId, before: cloneValue(record[field]), beforeExisted: Object.prototype.hasOwnProperty.call(record, field), after: value, afterExisted: true };
  record[field] = value;
  saveTargetedChanges([change], 'Змінено запис звітності', 'Звітність');
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
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return false; }
  if (!clientModel.findClientById(db, clientId) || !isValidMonthPeriodKey(monthKey)) return false;
  const amount = normalizeNonNegativeAmount(rawValue);
  if (!amount.ok) return false;
  const normalized = amount.value;
  const clientData = db.incomeRecords[clientId] ||= {};
  const change = { path: ['incomeRecords', clientId, monthKey], clientId, before: cloneValue(clientData[monthKey]), beforeExisted: Object.prototype.hasOwnProperty.call(clientData, monthKey), after: normalized, afterExisted: true };
  clientData[monthKey] = normalized;
  saveTargetedChanges([change], 'Змінено дохід', 'Доходи');
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
  const amount = normalizeNonNegativeAmount(value);
  const normalized = amount.ok ? Number(amount.value) : NaN;
  if (!Number.isFinite(normalized) || normalized <= 0) return false;
  db.settings.minWage = normalized;
  save('Змінено мінімальну заробітну плату', 'Налаштування');
  return true;
}

/** Fill a month's invoiced-service column from the service price on every
 * active client card, producing only one local save for the whole column. */
export function autofillMonthlyCharges(monthKey) {
  if (!canEditData()) { window.dispatchEvent(new CustomEvent('harmony:access-denied')); return 0; }
  if (!isValidMonthPeriodKey(monthKey)) return 0;
  let changed = 0;
  const changes = [];
  getVisibleClients().forEach((client) => {
    const amount = normalizeNonNegativeAmount(String(client.serviceCost ?? ''));
    if (!amount.ok || !amount.value) return;
    const month = (db.monthlyPayments[client.id] ||= {})[monthKey] ||= {};
    if (month.charged === amount.value) return;
    changes.push({ path: ['monthlyPayments', client.id, monthKey, 'charged'], clientId: client.id, before: cloneValue(month.charged), beforeExisted: Object.prototype.hasOwnProperty.call(month, 'charged'), after: amount.value, afterExisted: true });
    month.charged = amount.value;
    changed += 1;
  });
  if (changed) saveTargetedChanges(changes, 'Автоматично заповнено нарахування послуг', 'Оплати');
  return changed;
}

export function setMonthlyTaxDeadline(periodKey, value) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(periodKey) || !isValidOptionalIsoDate(value)) return false;
  db.settings.monthlyDeadlines[periodKey] = value;
  save('Змінено місячний податковий дедлайн', 'Налаштування');
  return true;
}

export function setQuarterlyTaxDeadline(taxKey, periodKey, value) {
  if (!['group3', 'esv'].includes(taxKey) || !/^\d{4}-(?:q1|half|9m|year)$/.test(periodKey) || !isValidOptionalIsoDate(value)) return false;
  db.settings.quarterlyDeadlines[taxKey][periodKey] = value;
  save('Змінено квартальний податковий дедлайн', 'Налаштування');
  return true;
}

export function setReportDeadline(scope, periodKeyOrNull, value) {
  const validKey = scope === 'annual' ? /^\d{4}$/.test(periodKeyOrNull) : /^\d{4}-(?:q1|half|9m|year)$/.test(periodKeyOrNull);
  if (!['annual', 'quarterly'].includes(scope) || !validKey || !isValidOptionalIsoDate(value)) return false;
  if (scope === 'annual') db.settings.reportDeadlines.annual[periodKeyOrNull] = value;
  else db.settings.reportDeadlines.quarterly[periodKeyOrNull] = value;
  save('Змінено дедлайн звітності', 'Налаштування');
  return true;
}

export function setAppearanceSetting(key, value) {
  db.settings.appearance ||= { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 };
  db.settings.appearance[key] = value;
  save();
}

export function setDropdownOptions(key, rawValue) {
  if (!['prro', 'currency', 'kepIssuer'].includes(key)) return false;
  const values = String(rawValue || '').split(/[\n,;]/).map((item) => item.trim()).filter(Boolean);
  db.settings.dropdownOptions ||= { prro: [], currency: [], kepIssuer: [] };
  db.settings.dropdownOptions[key] = [...new Set(values)].slice(0, 100);
  save('Змінено варіанти випадаючого списку', 'Налаштування');
  return true;
}

export function setActivityReference(kind, rows) {
  if (!['kved', 'nace'].includes(kind) || !Array.isArray(rows) || !rows.length) return false;
  db.settings.activityReferences ||= {};
  db.settings.activityReferences[kind] = rows;
  return save(`Оновлено довідник ${kind === 'kved' ? 'КВЕД' : 'NACE'}`, 'Налаштування') !== false;
}

// ---------------------------------------------------------------------------
// Bulk import / full-database restore
// ---------------------------------------------------------------------------

/** Replace the entire in-memory database (used by "restore from backup file"). */
export async function replaceDatabase(newDb) {
  if (currentAccessRole !== 'administrator') throw new Error('Відновлення резервної копії доступне лише адміністратору.');
  validateBackupDatabase(newDb);
  // Persist first, then reload through the repository normalizer. This keeps
  // old, valid backups compatible when newer optional collections are added.
  await storage.saveRestoredDatabase(newDb);
  db = await storage.reloadDatabase();
  lastSnapshot = cloneValue(db); lastBusinessSnapshot = businessSnapshot(db); undoStack.length = 0;
  return db;
}
