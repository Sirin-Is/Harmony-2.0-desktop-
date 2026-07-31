// Relationship checks shared by backup restore and the admin diagnostics.
// They deliberately do not validate optional historical employee IDs: a
// payroll row remains meaningful even after an employee is removed from a
// current client card.

function hasKnownClient(clientIds, clientId) {
  return !clientId || clientIds.has(String(clientId));
}

function recordIssues(records, clientIds, label) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((record) => record?.clientId && !hasKnownClient(clientIds, record.clientId))
    .map((record) => `${label}: не знайдено ФОП ${record.clientId}.`);
}

function keyedClientIssues(records, clientIds, label) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return [];
  return Object.keys(records)
    .filter((clientId) => !hasKnownClient(clientIds, clientId))
    .map((clientId) => `${label}: не знайдено ФОП ${clientId}.`);
}

function compoundKeyIssues(records, clientIds, label) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return [];
  return Object.keys(records)
    .map((key) => ({ key, clientId: key.split('|')[0] }))
    .filter(({ clientId }) => !hasKnownClient(clientIds, clientId))
    .map(({ key }) => `${label}: не знайдено ФОП для запису ${key}.`);
}

/** Returns readable, non-mutating findings for references to absent clients. */
export function collectDatabaseRelationshipIssues(database) {
  const clientIds = new Set((database?.clients || []).map((client) => String(client?.id || '')).filter(Boolean));
  return [
    ...keyedClientIssues(database?.monthlyPayments, clientIds, 'Оплати'),
    ...keyedClientIssues(database?.incomeRecords, clientIds, 'Доходи'),
    ...compoundKeyIssues(database?.taxRecords, clientIds, 'Податки'),
    ...compoundKeyIssues(database?.reportRecords, clientIds, 'Звітність'),
    ...recordIssues(database?.calendarEvents, clientIds, 'Календар'),
    ...recordIssues(database?.hrOrders, clientIds, 'Кадрові документи'),
    ...recordIssues(database?.hrMonthlyDocuments, clientIds, 'Кадрові документи'),
    ...recordIssues(database?.payrollRecords, clientIds, 'Виплата зарплати'),
  ];
}
