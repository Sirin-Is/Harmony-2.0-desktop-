function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeHrOrderNumber(value) {
  return String(value || '')
    .trim()
    .replace(/^№\s*/u, '')
    .normalize('NFKC')
    .replace(/^no\.?\s*/iu, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('uk');
}

export function validateHrOrder(fields, existingOrders = [], currentId = null) {
  const required = ['clientId', 'number', 'date', 'subject', 'effectiveDate'];
  if (required.some((field) => !String(fields?.[field] || '').trim())) {
    return { ok: false, reason: 'Заповніть усі обов’язкові реквізити кадрового документа.' };
  }
  if (!isIsoDate(fields.date) || !isIsoDate(fields.effectiveDate)) {
    return { ok: false, reason: 'Вкажіть коректні дати кадрового документа.' };
  }
  const number = normalizeHrOrderNumber(fields.number);
  const duplicate = existingOrders.some((order) => order.id !== currentId
    && order.clientId === fields.clientId
    && normalizeHrOrderNumber(order.number) === number);
  if (duplicate) return { ok: false, reason: 'Документ із таким номером уже є для цього ФОП.' };
  return { ok: true, reason: '' };
}
