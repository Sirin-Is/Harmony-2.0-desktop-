import { escapeHtml } from './utils.js';
import { activityPermission, findActivityByCode, normalizeActivityCode } from './data/activity-reference.js';
import { readSpreadsheetRows } from './spreadsheet-security.js';
import { showToast } from './toast.js';

function additional(value) {
  if (Array.isArray(value)) return value;
  try { return Array.isArray(JSON.parse(value || '')) ? JSON.parse(value) : []; } catch { return []; }
}

function codeList(client) {
  return [client.kvedMainCode && { code: client.kvedMainCode, name: client.kvedMainName || '' }, ...additional(client.kvedAdditional)]
    .filter(Boolean).filter((item) => item.code);
}

export function validateKved(client) {
  const groupIndex = { '1': 2, '2': 3, '3': 4 }[String(client.group)];
  return codeList(client).map((item) => {
    const code = normalizeActivityCode(item.code);
    const row = findActivityByCode('kved', code);
    if (!groupIndex || !row) return { code, name: item.name || '', kind: 'unknown', label: !groupIndex ? 'Групу не обрано' : 'Код не знайдено у довіднику', note: '' };
    const permission = activityPermission(row[groupIndex]);
    const note = String(row[5] || '').trim();
    if (permission === 'partial') return { code, name: row[1] || item.name || '', kind: 'partial', label: 'Обмежено дозволено', note };
    if (permission === 'blocked') return { code, name: row[1] || item.name || '', kind: 'blocked', label: 'Не дозволено', note: '' };
    if (permission !== 'allowed') return { code, name: row[1] || item.name || '', kind: 'unknown', label: 'Статус не вказано у довіднику', note: '' };
    return { code, name: row[1] || item.name || '', kind: 'allowed', label: 'Дозволено', note: '' };
  });
}

export const hasKvedIssues = (client) => validateKved(client).some((item) => item.kind !== 'allowed');

let dialog;
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'app-dialog kved-check-dialog';
  document.body.appendChild(dialog);
  return dialog;
}

export function openKvedResults(title, entries, onlyIssues = false, includeClient = false) {
  const el = ensureDialog();
  const shown = onlyIssues ? entries.filter((item) => item.kind !== 'allowed') : entries;
  const rows = shown.map((item) => `<tr>${includeClient ? `<td>${escapeHtml(item.clientName || '-')}</td>` : ''}<td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name || '-')}</td><td><span class="kved-result ${item.kind}">${escapeHtml(item.label)}</span></td><td>${escapeHtml(item.note || '-')}</td></tr>`).join('');
  const clientHeader = includeClient ? '<th>ФОП</th>' : '';
  el.innerHTML = `<form method="dialog" class="app-dialog-form"><header><h2>${escapeHtml(title)}</h2><button class="close" type="submit" aria-label="Закрити">×</button></header><div class="kved-result-body">${rows ? `<table class="table kved-results-table"><thead><tr>${clientHeader}<th>КВЕД</th><th>Назва</th><th>Статус</th><th>Причина / примітка</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">Проблемних КВЕД не знайдено.</p>'}</div><footer><button class="primary" type="submit">Закрити</button></footer></form>`;
  el.showModal();
}

let batchDialog;
const BATCH_KVED_INITIAL_ROWS = 10;

function batchKvedRowHtml(index, code = '') {
  return `<tr><td><input class="batch-kved-code" data-batch-kved-code="${index}" placeholder="XX.XX" value="${escapeHtml(code)}" aria-label="Код КВЕД ${index + 1}"></td><td data-batch-kved-name="${index}">—</td><td data-batch-kved-status="${index}">—</td></tr>`;
}

function batchKvedRows(codes = []) {
  const count = Math.max(BATCH_KVED_INITIAL_ROWS, codes.length);
  return Array.from({ length: count }, (_, index) => batchKvedRowHtml(index, codes[index] || '')).join('');
}

function batchColumn(row, names) {
  const normalizedNames = new Set(names.map((name) => name.replace(/[_\s]+/g, ' ').trim().toLocaleLowerCase('uk-UA')));
  const key = Object.keys(row).find((item) => normalizedNames.has(item.replace(/[_\s]+/g, ' ').trim().toLocaleLowerCase('uk-UA')));
  return key === undefined ? '' : String(row[key] ?? '').trim();
}

function batchCodesFromSpreadsheet(rows) {
  const codes = rows.map((row) => {
    const explicit = batchColumn(row, ['код КВЕД', 'код ВЕД', 'код']);
    if (explicit) return normalizeActivityCode(explicit);
    return Object.values(row).map((value) => normalizeActivityCode(value)).find((code) => /^\d{2}(?:\.\d{2})?$/.test(code)) || '';
  }).filter(Boolean);
  return [...new Set(codes)];
}

function refreshBatchKvedCheck() {
  const group = batchDialog.querySelector('[data-batch-kved-group]')?.value || '1';
  batchDialog.querySelectorAll('[data-batch-kved-code]').forEach((input) => {
    const index = input.dataset.batchKvedCode;
    const result = input.value.trim() ? validateKved({ group, kvedMainCode: input.value })[0] : null;
    batchDialog.querySelector(`[data-batch-kved-name="${index}"]`).textContent = result?.name || '—';
    const status = result?.kind === 'partial' && result.note
      ? `<button type="button" class="kved-result partial" data-kved-note="${escapeHtml(result.note)}" title="Натисніть, щоб переглянути примітку">${escapeHtml(result.label)}</button>`
      : result ? `<span class="kved-result ${result.kind}">${escapeHtml(result.label)}</span>` : '—';
    batchDialog.querySelector(`[data-batch-kved-status="${index}"]`).innerHTML = status;
  });
}

function setBatchKvedGroup(group) {
  if (!['1', '2', '3'].includes(String(group))) return;
  const field = batchDialog.querySelector('[data-batch-kved-group]');
  if (!field) return;
  field.value = String(group);
  batchDialog.querySelectorAll('[data-batch-kved-group-option]').forEach((button) => {
    const active = button.dataset.batchKvedGroupOption === String(group);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  refreshBatchKvedCheck();
}

function setBatchKvedRows(codes = []) {
  batchDialog.querySelector('[data-batch-kved-rows]').innerHTML = batchKvedRows(codes);
  refreshBatchKvedCheck();
}

export function openBatchKvedCheck() {
  if (!batchDialog) {
    batchDialog = document.createElement('dialog');
    batchDialog.className = 'app-dialog kved-check-dialog';
    document.body.appendChild(batchDialog);
    batchDialog.addEventListener('input', (event) => {
      if (event.target.matches('[data-batch-kved-code]')) refreshBatchKvedCheck();
    });
    batchDialog.addEventListener('change', async (event) => {
      if (!event.target.matches('[data-batch-kved-import-file]')) return;
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const codes = batchCodesFromSpreadsheet(await readSpreadsheetRows(file));
        if (!codes.length) throw new Error('У файлі не знайдено кодів КВЕД. Використайте колонку «Код КВЕД» або «Код».');
        setBatchKvedRows(codes);
        showToast(`Імпортовано ${codes.length} кодів КВЕД.`, 'success');
      } catch (error) {
        showToast(error.message || 'Не вдалося прочитати файл КВЕД.', 'error');
      } finally { event.target.value = ''; }
    });
    batchDialog.addEventListener('click', (event) => {
      const groupOption = event.target.closest('[data-batch-kved-group-option]');
      if (groupOption) setBatchKvedGroup(groupOption.dataset.batchKvedGroupOption);
      const note = event.target.closest('[data-kved-note]')?.dataset.kvedNote;
      if (note) showToast(note, 'info', 8000);
      if (event.target.closest('[data-import-batch-kved]')) batchDialog.querySelector('[data-batch-kved-import-file]')?.click();
      if (event.target.closest('[data-clear-batch-kved]')) {
        setBatchKvedRows();
        batchDialog.querySelector('[data-batch-kved-code]')?.focus();
      }
    });
  }
  batchDialog.innerHTML = `<form method="dialog" class="app-dialog-form"><header><h2>Одночасна перевірка КВЕД</h2><button class="close" type="submit" aria-label="Закрити">×</button></header><div class="batch-kved-controls"><div class="batch-kved-group-switches" role="group" aria-label="Група єдиного податку"><button type="button" class="batch-kved-group-switch active" data-batch-kved-group-option="1" aria-pressed="true">1 група</button><button type="button" class="batch-kved-group-switch" data-batch-kved-group-option="2" aria-pressed="false">2 група</button><button type="button" class="batch-kved-group-switch" data-batch-kved-group-option="3" aria-pressed="false">3 група</button></div><input type="hidden" data-batch-kved-group value="1"><span class="batch-kved-divider" aria-hidden="true">|</span><button class="secondary" type="button" data-import-batch-kved>Імпорт</button><input type="file" accept=".xlsx,.xls,.csv" data-batch-kved-import-file hidden></div><div class="kved-result-body"><table class="table batch-kved-table"><thead><tr><th>Код</th><th>Назва</th><th>Статус</th></tr></thead><tbody data-batch-kved-rows>${batchKvedRows()}</tbody></table></div><footer><button class="secondary" type="button" data-clear-batch-kved>Очистити</button><button class="primary" type="submit">Закрити</button></footer></form>`;
  batchDialog.showModal();
}
