import { escapeHtml } from './utils.js';
import { getActivityReference } from './data/activity-reference.js';

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
  const directory = new Map(getActivityReference().kved.map((row) => [String(row[0]).trim(), row]));
  return codeList(client).map((item) => {
    const code = String(item.code).trim();
    const row = directory.get(code);
    if (!groupIndex || !row) return { code, name: item.name || '', kind: 'unknown', label: !groupIndex ? 'Групу не обрано' : 'Код не знайдено у довіднику', note: '' };
    const permission = row[groupIndex];
    const note = String(row[5] || '').trim();
    if (note) return { code, name: row[1] || item.name || '', kind: 'partial', label: 'Частково заборонено', note };
    if (permission === 'ні') return { code, name: row[1] || item.name || '', kind: 'blocked', label: 'Повністю заборонено', note: '' };
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
