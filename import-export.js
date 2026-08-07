// import-export.js
// Client list <-> Excel/CSV, using the SheetJS (XLSX) library. The library
// is loaded lazily, on first actual export/import click.

import { todayIso } from './utils';
import { db, getVisibleClients, getCustomColumns, upsertClient, findClientByName } from './state.js';
import { validateImportRow } from './validation.js';
import { showToast } from './toast.js';
import { loadSpreadsheetLibrary, readSpreadsheetRows } from './spreadsheet-security.js';

const IMPORT_COLUMNS = [
  { header: 'ПІБ / назва ФОП', key: 'name' },
  { header: 'Статус', key: 'status' },
  { header: 'Група ЄП', key: 'group' },
  { header: 'Ставка ЄП (частка, напр. 0.05)', key: 'rate' },
  { header: 'Вартість обслуговування, грн', key: 'serviceCost' },
  { header: 'Валюта доходу', key: 'currency' },
  { header: 'Телефон', key: 'phone' },
  { header: 'Ел. пошта', key: 'email' },
  { header: 'Зв\'язок (Telegram)', key: 'contactLink' },
  { header: 'Доступ до банку', key: 'bankAccess' },
  { header: 'П/РРО', key: 'prro' },
  { header: 'Наймані', key: 'employees' },
  { header: 'ДПІ', key: 'taxOffice' },
  { header: 'Банківські рахунки', key: 'banks' },
  { header: 'Види діяльності (КВЕД)', key: 'activities' },
  { header: 'Видавець КЕП', key: 'kepIssuer' },
  { header: 'КЕП дійсний до (дата, РРРР-ММ-ДД)', key: 'kepExpiry' },
];

export async function exportClientsToExcel(onlyIds = null) {
  const XLSX = await loadSpreadsheetLibrary();
  const columns = getCustomColumns();
  const idSet = onlyIds ? new Set(onlyIds) : null;
  const clients = getVisibleClients().filter((item) => !idSet || idSet.has(item.id));
  if (!clients.length) {
    showToast('Немає ФОП для експорту.', 'error');
    return;
  }
  const headerRow = [...IMPORT_COLUMNS.map((column) => column.header), ...columns.map((column) => column.name)];
  const dataRows = clients.map((item) => [
    ...IMPORT_COLUMNS.map((column) => item[column.key] ?? ''),
    ...columns.map((column) => item.customFields?.[column.id] ?? ''),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  sheet['!cols'] = headerRow.map(() => ({ wch: 26 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'ФОП');
  const suffix = onlyIds ? `-selected-${clients.length}` : '';
  XLSX.writeFile(workbook, `fop-oblik-export${suffix}-${todayIso()}.xlsx`);
}

function applyImportedRow(row) {
  const name = String(row[IMPORT_COLUMNS[0].header] ?? '').trim();
  if (!name) return { status: 'skipped' };

  const existing = findClientByName(name);
  const fields = { name };
  IMPORT_COLUMNS.slice(1).forEach((column) => {
    const value = row[column.header];
    if (value !== undefined && String(value).trim() !== '') fields[column.key] = String(value).trim();
  });
  fields.customFields = { ...(existing?.customFields || {}) };
  getCustomColumns().forEach((column) => {
    const value = row[column.name];
    if (value !== undefined && String(value).trim() !== '') fields.customFields[column.id] = String(value).trim();
  });

  upsertClient(fields, existing?.id || null);
  return { status: existing ? 'updated' : 'created' };
}

export async function importClientsFromFile(file) {
  let rows;
  try {
    rows = await readSpreadsheetRows(file);
  } catch (error) {
    if (error instanceof Error && /^(Файл|Таблиця|У таблиці|Комірка)/.test(error.message)) throw error;
    throw new Error('Не вдалося прочитати файл. Перевірте, що це коректний .xlsx/.xls/.csv зі структурою колонок як у прикладі.');
  }
  if (!rows.length) throw new Error('Файл порожній або не містить рядків даних.');
  if (!Object.hasOwn(rows[0], IMPORT_COLUMNS[0].header)) {
    throw new Error(`У таблиці немає обов’язкової колонки «${IMPORT_COLUMNS[0].header}».`);
  }

  const summary = { created: 0, updated: 0, skipped: 0, warnings: [] };
  rows.forEach((row, index) => {
    // SheetJS rows use Ukrainian column headers; validate normalized
    // values rather than looking for internal field names in the sheet.
    const normalized = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column.key, row[column.header]]));
    const validation = validateImportRow(normalized, index + 2);
    summary.warnings.push(...validation.warnings);
    if (validation.errors.length) {
      summary.skipped += 1;
      summary.warnings.push(...validation.errors.map((message) => `${message} Рядок пропущено.`));
      return;
    }
    const { status } = applyImportedRow(row);
    summary[status] += 1;
  });
  return summary;
}
