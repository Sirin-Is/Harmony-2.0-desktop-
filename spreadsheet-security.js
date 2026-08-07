// Centralized limits for spreadsheet files received from outside Harmony.
// SheetJS is intentionally loaded only after a user starts an import/export.

export const MAX_SPREADSHEET_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SPREADSHEET_DATA_ROWS = 10000;
export const MAX_SPREADSHEET_COLUMNS = 100;
export const MAX_SPREADSHEET_CELLS = 500000;
export const MAX_SPREADSHEET_CELL_CHARS = 10000;
export const MAX_SPREADSHEET_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_SPREADSHEET_ARCHIVE_ENTRIES = 1000;

let xlsxPromise;

export function loadSpreadsheetLibrary() {
  if (!xlsxPromise) xlsxPromise = import('xlsx');
  return xlsxPromise;
}

export function assertSpreadsheetFile(file) {
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= 0) throw new Error('Файл порожній або недоступний.');
  if (size > MAX_SPREADSHEET_FILE_BYTES) throw new Error('Файл завеликий. Максимальний розмір таблиці — 5 МБ.');
}

export function assertSpreadsheetRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Таблиця має некоректну структуру.');
  if (rows.length > MAX_SPREADSHEET_DATA_ROWS) throw new Error(`У таблиці понад ${MAX_SPREADSHEET_DATA_ROWS} рядків даних.`);
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Таблиця містить некоректний рядок.');
    const entries = Object.entries(row);
    if (entries.length > MAX_SPREADSHEET_COLUMNS) throw new Error(`У таблиці понад ${MAX_SPREADSHEET_COLUMNS} колонок.`);
    for (const [header, value] of entries) {
      if (String(header).length > MAX_SPREADSHEET_CELL_CHARS || String(value ?? '').length > MAX_SPREADSHEET_CELL_CHARS) {
        throw new Error(`Комірка перевищує ліміт ${MAX_SPREADSHEET_CELL_CHARS} символів.`);
      }
    }
  }
  return rows;
}

/** Reject oversized XLSX expansion before SheetJS inflates ZIP entries. */
export function assertSpreadsheetArchive(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  const view = new DataView(buffer);
  const minimumEocd = 22;
  let eocd = -1;
  for (let offset = bytes.length - minimumEocd; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('XLSX-архів пошкоджений або має непідтримуваний формат.');
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64-таблиці не підтримуються з міркувань безпеки.');
  }
  if (entries > MAX_SPREADSHEET_ARCHIVE_ENTRIES || centralOffset + centralSize > bytes.length) {
    throw new Error('XLSX-архів має некоректну або надмірну структуру.');
  }
  let offset = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('XLSX-архів має некоректний каталог файлів.');
    }
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (uncompressed === 0xffffffff) throw new Error('ZIP64-таблиці не підтримуються з міркувань безпеки.');
    expandedBytes += uncompressed;
    if (expandedBytes > MAX_SPREADSHEET_ARCHIVE_BYTES) {
      throw new Error('Розпакований XLSX перевищує безпечний ліміт 50 МБ.');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset > centralOffset + centralSize) throw new Error('XLSX-архів має некоректний каталог файлів.');
}

function assertWorksheetBounds(XLSX, sheet) {
  const reference = sheet?.['!fullref'] || sheet?.['!ref'];
  if (!reference) return;
  let range;
  try {
    range = XLSX.utils.decode_range(reference);
  } catch {
    throw new Error('Таблиця має некоректний діапазон комірок.');
  }
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  if (rowCount > MAX_SPREADSHEET_DATA_ROWS + 1) throw new Error(`У таблиці понад ${MAX_SPREADSHEET_DATA_ROWS} рядків даних.`);
  if (columnCount > MAX_SPREADSHEET_COLUMNS) throw new Error(`У таблиці понад ${MAX_SPREADSHEET_COLUMNS} колонок.`);
  if (rowCount * columnCount > MAX_SPREADSHEET_CELLS) throw new Error(`Таблиця перевищує ліміт ${MAX_SPREADSHEET_CELLS} комірок.`);
}

export async function readSpreadsheetRows(file) {
  assertSpreadsheetFile(file);
  const XLSX = await loadSpreadsheetLibrary();
  const buffer = await file.arrayBuffer();
  assertSpreadsheetArchive(buffer);
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    sheetRows: MAX_SPREADSHEET_DATA_ROWS + 2,
    sheets: 0,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  assertWorksheetBounds(XLSX, sheet);
  return assertSpreadsheetRows(XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }));
}
