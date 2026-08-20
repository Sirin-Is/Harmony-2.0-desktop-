// validation.js
// Central place for data-quality checks. Every function returns a plain
// list of human-readable Ukrainian messages (empty array = valid) so the
// UI layer can render them however it wants (banner, toast, inline field).

import { looksLikeEmail, normalizeNumberInput } from './utils';
import { safeContactHref } from './client-model.js';
import { isValidIsoDate } from './date-input.js';

const finiteNumber = (value) => {
  const normalized = normalizeNumberInput(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

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
  } else if (record.name.trim().length > 200) {
    errors.push('ПІБ / назва ФОП не може перевищувати 200 символів.');
  }

  if (record.email && !looksLikeEmail(record.email)) {
    errors.push(`Ел. пошта «${record.email}» виглядає некоректною.`);
  }

  if (record.serviceCost !== '' && record.serviceCost !== undefined) {
    const cost = finiteNumber(record.serviceCost);
    if (cost === null) errors.push('Вартість обслуговування має бути коректним числом.');
    else if (cost < 0) errors.push('Вартість обслуговування не може бути від’ємною.');
  }

  if (record.rnokpp && !/^\d{10}$/.test(String(record.rnokpp))) {
    errors.push('РНОКПП має складатися рівно з 10 цифр без роздільників.');
  }
  if (record.birthDate && !isValidIsoDate(record.birthDate)) errors.push('Дата народження некоректна.');

  [
    ['pricingBase', 'Базова вартість'],
    ['pricingStaff', 'Доплата за найманих працівників'],
    ['pricingPrro', 'Доплата за ПРРО'],
  ].forEach(([field, label]) => {
    if (record[field] === '' || record[field] === undefined) return;
    const amount = finiteNumber(record[field]);
    if (amount === null) errors.push(`${label} має бути коректним числом.`);
    else if (amount < 0) errors.push(`${label} не може бути від’ємною.`);
  });

  if (record.kepExpiry && !isValidIsoDate(record.kepExpiry)) {
    errors.push('Дата дії КЕП некоректна.');
  }

  if (record.contactLink) {
    if (!safeContactHref(record.contactLink)) warnings.push('Поле «Зв\'язок» не містить безпечного HTTPS-посилання t.me — воно буде показане як звичайний текст.');
  }

  const normalizedName = record.name?.trim().toLowerCase();
  if (normalizedName) {
    const duplicate = existingClients.find((item) => item.id !== currentId && item.name?.trim().toLowerCase() === normalizedName);
    if (duplicate) warnings.push(`ФОП з іменем «${record.name.trim()}» вже є в списку. Перевірте, чи це не дублікат.`);
  }

  return { errors, warnings };
}

/** Validate a custom-column definition from the "Нова/Змінити колонка" form. */
export function validateCustomColumn(column, existingColumns = [], currentId = null) {
  const errors = [];
  const name = String(column.name || '').trim();
  if (!name) errors.push('Вкажіть назву колонки.');
  else if (name.length > 80) errors.push('Назва колонки має містити не більше 80 символів.');
  else if (existingColumns.some((item) => item.id !== currentId && String(item.name || '').trim().toLocaleLowerCase('uk') === name.toLocaleLowerCase('uk'))) {
    errors.push('Колонка з такою назвою вже існує.');
  }
  if (!['text', 'number', 'date'].includes(column.type)) errors.push('Оберіть коректний тип даних.');
  return { errors, warnings: [] };
}

/** Row-level import check. Errors are skipped rather than silently persisted. */
export function validateImportRow(row, rowIndex) {
  const errors = [];
  const warnings = [];
  if (!row.name || String(row.name).trim().length < 2 || String(row.name).trim().length > 200) {
    errors.push(`Рядок ${rowIndex}: ПІБ / назва ФОП має містити 2–200 символів.`);
  }
  if (row.email && (!looksLikeEmail(row.email) || String(row.email).length > 320)) {
    errors.push(`Рядок ${rowIndex}: ел. пошта «${row.email}» виглядає некоректною.`);
  }
  if (row.serviceCost !== undefined && row.serviceCost !== '') {
    const cost = finiteNumber(row.serviceCost);
    if (cost === null) errors.push(`Рядок ${rowIndex}: вартість обслуговування має бути коректним числом.`);
    else if (cost < 0) errors.push(`Рядок ${rowIndex}: вартість обслуговування не може бути від’ємною.`);
  }
  const group = String(row.group || '').trim();
  const rate = normalizeNumberInput(row.rate);
  const allowedRates = { '1': ['0.1'], '2': ['0.2', '0.15', '0.1'], '3': ['0.05', '0.03'], 'Загальна': [''] };
  if (group && !Object.hasOwn(allowedRates, group)) errors.push(`Рядок ${rowIndex}: некоректна група ЄП.`);
  if (rate && (!Object.hasOwn(allowedRates, group) || !allowedRates[group].includes(rate))) errors.push(`Рядок ${rowIndex}: ставка ЄП не відповідає групі.`);
  if (row.kepExpiry && !isValidIsoDate(String(row.kepExpiry))) errors.push(`Рядок ${rowIndex}: дата дії КЕП некоректна.`);
  if (row.contactLink && !safeContactHref(String(row.contactLink))) warnings.push(`Рядок ${rowIndex}: Telegram-посилання буде збережено як звичайний текст.`);
  return { errors, warnings };
}
