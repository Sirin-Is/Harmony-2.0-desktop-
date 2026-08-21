function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const normalizeEmployeeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');

export function validateEmployee(fields) {
  if (!String(fields?.clientId || '').trim() || !String(fields?.name || '').trim() || !String(fields?.position || '').trim()) {
    return { ok: false, reason: 'Вкажіть ФОП, ПІБ працівника та посаду.' };
  }
  if ((fields.hireDate && !isIsoDate(fields.hireDate)) || (fields.dismissalDate && !isIsoDate(fields.dismissalDate))) {
    return { ok: false, reason: 'Вкажіть коректні дати прийняття та звільнення.' };
  }
  if (fields.dismissalDate && fields.hireDate && fields.dismissalDate < fields.hireDate) {
    return { ok: false, reason: 'Дата звільнення не може передувати даті прийняття.' };
  }
  return { ok: true, reason: '' };
}
