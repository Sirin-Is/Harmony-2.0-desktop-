export function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidOptionalIsoDate(value) {
  return value === '' || value === null || value === undefined || isValidIsoDate(value);
}

export function isValidMonthPeriodKey(value) {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(value || ''));
}

export function isValidQuarterPeriodKey(value) {
  return /^\d{4}-(?:q1|half|9m|year)$/.test(String(value || ''));
}

export function isValidTaxPeriodKey(realGroup, value) {
  return String(realGroup) === '3' ? isValidQuarterPeriodKey(value) : isValidMonthPeriodKey(value);
}

export function isValidReportPeriodKey(realGroup, value) {
  return String(realGroup) === '3' ? isValidQuarterPeriodKey(value) : /^\d{4}$/.test(String(value || ''));
}

export function validateTaxRecordChange(record, field, value) {
  const allowedFields = ['queuedDate', 'paidDate', 'deadline', 'exemption', 'note'];
  if (!allowedFields.includes(field)) return { ok: false, reason: 'Невідоме поле податкового запису.' };
  if (['queuedDate', 'paidDate', 'deadline'].includes(field) && !isValidOptionalIsoDate(value)) {
    return { ok: false, reason: 'Вкажіть коректну дату податкової операції.' };
  }
  const candidate = { ...record, [field]: value };
  if (candidate.queuedDate && candidate.paidDate && candidate.paidDate < candidate.queuedDate) {
    return { ok: false, reason: 'Дата сплати не може передувати даті набору в банку.' };
  }
  return { ok: true, reason: '' };
}

export function validateReportRecordChange(field, value) {
  if (!['submittedDate', 'deadline', 'note', 'notReportable'].includes(field)) return { ok: false, reason: 'Невідоме поле звітності.' };
  if (field === 'notReportable' && typeof value !== 'boolean') return { ok: false, reason: 'Некоректна ознака звітного періоду.' };
  if (['submittedDate', 'deadline'].includes(field) && !isValidOptionalIsoDate(value)) {
    return { ok: false, reason: 'Вкажіть коректну дату звітності.' };
  }
  return { ok: true, reason: '' };
}

export function validateCalendarEvent(fields) {
  if (!String(fields?.title || '').trim() || !String(fields?.note || '').trim()) {
    return { ok: false, reason: 'Вкажіть назву й опис задачі.' };
  }
  if (!isValidIsoDate(fields.eventDate)) return { ok: false, reason: 'Вкажіть коректну дату задачі.' };
  if (fields.eventTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fields.eventTime)) {
    return { ok: false, reason: 'Вкажіть коректний час задачі.' };
  }
  if (fields.workdayShift && !['previous', 'next'].includes(fields.workdayShift)) {
    return { ok: false, reason: 'Некоректне правило перенесення задачі.' };
  }
  const recurrence = fields.recurrence;
  if (!recurrence) return { ok: true, reason: '' };
  if (!['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'months'].includes(recurrence.frequency)) {
    return { ok: false, reason: 'Некоректна частота повторення задачі.' };
  }
  const interval = Number(recurrence.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 120) {
    return { ok: false, reason: 'Інтервал повторення має бути цілим числом від 1 до 120.' };
  }
  if (!isValidOptionalIsoDate(recurrence.until)) return { ok: false, reason: 'Некоректна дата завершення повторення.' };
  if (recurrence.until && recurrence.until < fields.eventDate) {
    return { ok: false, reason: 'Повторення не може завершуватися раніше дати початку.' };
  }
  return { ok: true, reason: '' };
}
