export const MAX_IDENTIFIER_LENGTH = 512;

// Harmony identifiers are opaque storage keys, not user-visible free text.
// The allowlist includes every format currently present in production:
// UUID, id-*, settings and compound keys separated with "|".
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:@|:-]+$/;
const IDENTIFIER_FIELDS = new Set(['id', 'clientId', 'employeeId', 'operationId', 'cancelledBy']);
const ARRAY_COLLECTIONS = ['clients', 'customColumns', 'calendarEvents', 'hrOrders', 'hrMonthlyDocuments', 'payrollRecords', 'auditOperations', 'auditEvents'];
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_SYNC_STRUCTURE_NODES = 100000;
const MAX_SYNC_STRUCTURE_DEPTH = 20;
const MAX_SYNC_STRING_CHARS = 250000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSafeIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && SAFE_IDENTIFIER_PATTERN.test(value);
}

export function assertSafeIdentifier(value, section = 'дані') {
  if (!isSafeIdentifier(value)) throw new Error(`Некоректний ідентифікатор у розділі: ${section}.`);
  return value;
}

/** Validate ID-shaped fields without interpreting ordinary user-entered text. */
export function validateIdentifiersInValue(root, section = 'дані') {
  const stack = [root];
  const visited = new WeakSet();
  while (stack.length) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (visited.has(value)) continue;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (IDENTIFIER_FIELDS.has(key) && child !== '' && child !== null && child !== undefined) {
        assertSafeIdentifier(child, section);
      }
      if (key === 'customFields' && isPlainObject(child)) {
        for (const customFieldId of Object.keys(child)) assertSafeIdentifier(customFieldId, section);
      }
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
}

/** Reject structures that could become prototype-pollution or resource attacks after sync. */
export function validateSyncPayload(root) {
  if (!isPlainObject(root)) throw new Error('Синхронізація містить некоректні дані запису.');
  const stack = [{ value: root, depth: 0 }];
  const visited = new WeakSet();
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_SYNC_STRUCTURE_NODES) throw new Error('Запис синхронізації містить забагато елементів.');
    if (typeof value === 'string') {
      if (value.length > MAX_SYNC_STRING_CHARS) throw new Error('Запис синхронізації містить надто довге текстове поле.');
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (depth >= MAX_SYNC_STRUCTURE_DEPTH) throw new Error('Запис синхронізації має надто глибоку структуру.');
    if (visited.has(value)) throw new Error('Запис синхронізації містить циклічну структуру.');
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (!Array.isArray(value) && UNSAFE_KEYS.has(key)) throw new Error('Запис синхронізації містить небезпечне імʼя поля.');
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  validateIdentifiersInValue(root, 'синхронізація');
}

function validateMapKeys(value, section, nested = false) {
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    assertSafeIdentifier(key, section);
    if (nested && isPlainObject(child)) {
      for (const nestedKey of Object.keys(child)) assertSafeIdentifier(nestedKey, section);
    }
  }
}

function validateNestedUniqueIds(records, section) {
  if (!Array.isArray(records)) return;
  const ids = new Set();
  for (const record of records) {
    if (!isPlainObject(record) || record.id === '' || record.id === null || record.id === undefined) continue;
    assertSafeIdentifier(record.id, section);
    if (ids.has(record.id)) throw new Error(`Повторюваний ідентифікатор у розділі: ${section}.`);
    ids.add(record.id);
  }
}

/** Validate identifiers and identifier-bearing map keys in a full database snapshot. */
export function validateDatabaseIdentifiers(database, includeAuditSnapshots = true) {
  for (const collection of ARRAY_COLLECTIONS) {
    if (!Array.isArray(database?.[collection])) continue;
    const ids = new Set();
    for (const record of database[collection]) {
      if (!isPlainObject(record)) continue;
      assertSafeIdentifier(record.id, collection);
      if (ids.has(record.id)) throw new Error(`Повторюваний ідентифікатор у розділі: ${collection}.`);
      ids.add(record.id);
      validateIdentifiersInValue(record, collection);
      if (collection === 'clients') {
        validateNestedUniqueIds(record.employees, 'clients.employees');
        validateNestedUniqueIds(record.accounts, 'clients.accounts');
        validateNestedUniqueIds(record.kvedAdditional, 'clients.kvedAdditional');
      }
      if (collection === 'calendarEvents') validateNestedUniqueIds(record.subtasks, 'calendarEvents.subtasks');
      if (includeAuditSnapshots && collection === 'auditOperations' && isPlainObject(record.beforeSnapshot)) {
        validateDatabaseIdentifiers(record.beforeSnapshot, false);
      }
    }
  }

  validateMapKeys(database?.monthlyPayments, 'monthlyPayments', true);
  validateMapKeys(database?.incomeRecords, 'incomeRecords', true);
  validateMapKeys(database?.taxRecords, 'taxRecords');
  validateMapKeys(database?.reportRecords, 'reportRecords');

  const settings = database?.settings;
  if (isPlainObject(settings)) {
    validateMapKeys(settings.monthlyDeadlines, 'settings.monthlyDeadlines');
    validateMapKeys(settings.quarterlyDeadlines?.group3, 'settings.quarterlyDeadlines.group3');
    validateMapKeys(settings.quarterlyDeadlines?.esv, 'settings.quarterlyDeadlines.esv');
    validateMapKeys(settings.reportDeadlines?.annual, 'settings.reportDeadlines.annual');
    validateMapKeys(settings.reportDeadlines?.quarterly, 'settings.reportDeadlines.quarterly');
  }
}
