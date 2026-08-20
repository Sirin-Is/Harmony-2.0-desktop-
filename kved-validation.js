import { escapeHtml } from './utils.js';
import { findActivityByCode, normalizeActivityCode } from './data/activity-reference.js';

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
    const permission = row[groupIndex];
    const note = String(row[5] || '').trim();
    if (note) return { code, name: row[1] || item.name || '', kind: 'partial', label: 'Обмежено дозволено', note };
    if (permission === 'ні') return { code, name: row[1] || item.name || '', kind: 'blocked', label: 'Не дозволено', note: '' };
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
export function openBatchKvedCheck() {
  if (!batchDialog) {
    batchDialog = document.createElement('dialog');
    batchDialog.className = 'app-dialog kved-check-dialog';
    document.body.appendChild(batchDialog);
  }
  const inputRows = Array.from({ length: 10 }, (_, index) => `<tr><td><input class="batch-kved-code" data-batch-kved-code="${index}" placeholder="XX.XX" aria-label="Код КВЕД ${index + 1}"></td><td data-batch-kved-name="${index}">—</td><td data-batch-kved-status="${index}">—</td></tr>`).join('');
  batchDialog.innerHTML = `<form method="dialog" class="app-dialog-form"><header><h2>Одночасна перевірка КВЕД</h2><button class="close" type="submit" aria-label="Закрити">×</button></header><div class="batch-kved-controls"><label>Група ЄП<select data-batch-kved-group><option value="1">1 група</option><option value="2">2 група</option><option value="3">3 група</option></select></label></div><div class="kved-result-body"><table class="table batch-kved-table"><thead><tr><th>Код</th><th>Назва</th><th>Статус</th></tr></thead><tbody>${inputRows}</tbody></table></div><footer><button class="secondary" type="button" data-clear-batch-kved>Очистити</button><button class="primary" type="submit">Закрити</button></footer></form>`;
  const refresh = () => {
    const group = batchDialog.querySelector('[data-batch-kved-group]').value;
    batchDialog.querySelectorAll('[data-batch-kved-code]').forEach((input) => {
      const index = input.dataset.batchKvedCode;
      const result = input.value.trim() ? validateKved({ group, kvedMainCode: input.value })[0] : null;
      batchDialog.querySelector(`[data-batch-kved-name="${index}"]`).textContent = result?.name || '—';
      batchDialog.querySelector(`[data-batch-kved-status="${index}"]`).innerHTML = result ? `<span class="kved-result ${result.kind}">${escapeHtml(result.label)}</span>` : '—';
    });
  };
  batchDialog.querySelector('[data-batch-kved-group]').addEventListener('change', refresh);
  batchDialog.querySelectorAll('[data-batch-kved-code]').forEach((input) => input.addEventListener('input', refresh));
  batchDialog.querySelector('[data-clear-batch-kved]').addEventListener('click', () => {
    batchDialog.querySelectorAll('[data-batch-kved-code]').forEach((input) => { input.value = ''; });
    refresh();
    batchDialog.querySelector('[data-batch-kved-code]')?.focus();
  });
  batchDialog.showModal();
}
