const DIRECT_ID_TYPES = new Set([
  'clients', 'custom_columns', 'calendar_events', 'hr_orders',
  'hr_monthly_documents', 'payroll_records', 'audit_operations', 'audit_events',
]);

export function expectedRecordId(entityType: string, payload: Record<string, unknown>): string | null {
  if (DIRECT_ID_TYPES.has(entityType)) return typeof payload.id === 'string' ? payload.id : null;
  if (entityType === 'monthly_payments' || entityType === 'income_records') {
    return typeof payload.clientId === 'string' && typeof payload.monthKey === 'string'
      ? `${payload.clientId}|${payload.monthKey}`
      : null;
  }
  if (entityType === 'tax_records' || entityType === 'report_records') {
    return typeof payload.key === 'string' ? payload.key : null;
  }
  if (entityType === 'settings') return 'default';
  return null;
}

export function assertRecordPayloadIdentity(entityType: string, rowId: string, payload: Record<string, unknown>): void {
  if (expectedRecordId(entityType, payload) !== rowId) {
    throw new Error('Ідентифікатор запису не відповідає його payload.');
  }
}
