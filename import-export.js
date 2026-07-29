// import-export.js
// Client list <-> Excel/CSV, using the SheetJS (XLSX) library. The library
// is loaded lazily, on first actual export/import click — NOT via a
// blocking <script> tag in index.html. That matters a lot for a
// double-click-to-run desktop-style tool: if index.html eagerly loaded a
// CDN script before the app's own code, a slow or unreachable network
// would delay (or in the worst case hang) the whole app becoming
// interactive, even though nothing but this one feature needs the internet.

import { todayIso } from './utils.js';
import { db, getVisibleClients, getCustomColumns, upsertClient, findClientByName } from './state.js';
import { validateImportRow } from './validation.js';
import { showToast } from './toast.js';

const XLSX_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxLoadPromise = null;

/** Load the XLSX library once, on demand, and cache the in-flight/resolved promise. */
function ensureXlsxLoaded() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = XLSX_CDN_URL;
    script.onload = () => resolve();
    script.onerror = () => {
      xlsxLoadPromise = null; // allow retrying later (e.g. once the network is back)
      reject(new Error('Не вдалося завантажити бібліотеку Excel — перевірте інтернет-з’єднання і спробуйте ще раз.'));
    };
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}

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

/**
 * Export clients to an .xlsx file with the same columns import expects.
 * @param {string[]|null} onlyIds - if given, export just these clients (bulk selection); otherwise export all visible clients.
 */
export async function exportClientsToExcel(onlyIds = null) {
  try {
    await ensureXlsxLoaded();
  } catch (error) {
    showToast(error.message, 'error', 8000);
    return;
  }
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

/**
 * Import clients from a File (xlsx/xls/csv). Resolves with a summary of
 * how many rows were created/updated/skipped, plus any per-row warnings.
 */
export async function importClientsFromFile(file) {
  await ensureXlsxLoaded(); // rejects with a clear message if the network is unavailable; caller shows it as a toast
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не вдалося прочитати файл.'));
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (!rows.length) {
          reject(new Error('Файл порожній або не містить рядків даних.'));
          return;
        }
        const summary = { created: 0, updated: 0, skipped: 0, warnings: [] };
        rows.forEach((row, index) => {
          summary.warnings.push(...validateImportRow(row, index + 2)); // +2: header row + 1-based
          const { status } = applyImportedRow(row);
          summary[status] += 1;
        });
        resolve(summary);
      } catch (error) {
        reject(new Error('Не вдалося прочитати файл. Перевірте, що це коректний .xlsx/.xls/.csv зі структурою колонок як у прикладі.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
