// validation.js
// Central place for data-quality checks. Every function returns a plain
// list of human-readable Ukrainian messages (empty array = valid) so the
// UI layer can render them however it wants (banner, toast, inline field).

import { looksLikeEmail, toNumber } from './utils';

/**
 * Validate a client record collected from the "Новий/Редагувати ФОП" form.
 * @param {object} record - candidate field values (strings from the form)
 * @param {object[]} existingClients - all other clients, for duplicate-name check
 * @param {string|null} currentId - id being edited (excluded from duplicate check)
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateClient(record, existingClients, currentId) {
  const errors = [];
  const warnings = [];

  if (!record.name || record.name.trim().length < 2) {
    errors.push('Вкажіть ПІБ / назву ФОП (мінімум 2 символи).');
  }

  if (record.email && !looksLikeEmail(record.email)) {
    errors.push(`Ел. пошта «${record.email}» виглядає некоректною.`);
  }

  if (record.serviceCost !== '' && record.serviceCost !== undefined) {
    const cost = toNumber(record.serviceCost);
    if (cost < 0) errors.push('Вартість обслуговування не може бути від’ємною.');
  }

  if (record.kepExpiry && Number.isNaN(new Date(`${record.kepExpiry}T00:00:00`).getTime())) {
    errors.push('Дата дії КЕП некоректна.');
  }

  if (record.contactLink) {
    const looksSafe = /^https?:\/\//i.test(record.contactLink) || /^t\.me\//i.test(record.contactLink);
    if (!looksSafe) warnings.push('Посилання «Зв\'язок» не схоже на http(s)/t.me — воно буде показане як звичайний текст, без клікабельного посилання.');
  }

  const normalizedName = record.name?.trim().toLowerCase();
  if (normalizedName) {
    const duplicate = existingClients.find((item) => item.id !== currentId && item.name?.trim().toLowerCase() === normalizedName);
    if (duplicate) warnings.push(`ФОП з іменем «${record.name.trim()}» вже є в списку. Перевірте, чи це не дублікат.`);
  }

  return { errors, warnings };
}

/** Validate a custom-column definition from the "Нова/Змінити колонка" form. */
export function validateCustomColumn(column) {
  const errors = [];
  if (!column.name || column.name.trim().length < 1) errors.push('Вкажіть назву колонки.');
  if (!['text', 'number', 'date'].includes(column.type)) errors.push('Оберіть коректний тип даних.');
  return { errors, warnings: [] };
}

/** Row-level import check. Errors are skipped rather than silently persisted. */
export function validateImportRow(row, rowIndex) {
  const errors = [];
  const warnings = [];
  if (row.email && !looksLikeEmail(row.email)) {
    errors.push(`Рядок ${rowIndex}: ел. пошта «${row.email}» виглядає некоректною.`);
  }
  if (row.serviceCost !== undefined && row.serviceCost !== '' && toNumber(row.serviceCost) < 0) {
    errors.push(`Рядок ${rowIndex}: вартість обслуговування не може бути від’ємною.`);
  }
  return { errors, warnings };
}
