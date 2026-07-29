// render/dashboard.js
// Builds the "Огляд" table: one row per active client, with drag-to-reorder,
// per-row actions (edit/hide/delete), editable custom columns, a
// client-side search box (filtered via plain DOM show/hide, see main.js,
// so typing never loses focus or triggers a full re-render), row
// checkboxes for bulk actions, and a clickable name that opens the
// read-only Client Card (fewer clicks than the edit form for a quick look).

import { escapeHtml, moneyFormat, toNumber } from '../utils.js';
import { rateText, phoneLines, contactLinkHtml, kepStatusLabel } from '../client-model.js';
import { table } from './layout.js';
import { getVisibleClients, getCustomColumns } from '../state.js';
import { uiState } from '../ui-state.js';

function customColumnHeader(column) {
  return `<span>${escapeHtml(column.name)}</span>` +
    `<button class="column-control" data-edit-column="${column.id}" title="Змінити назву">✎</button>` +
    `<button class="column-control" data-delete-column="${column.id}" title="Видалити колонку">×</button>`;
}

function customColumnCells(item, columns) {
  return columns.map((column) => {
    const inputType = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
    const value = item.customFields?.[column.id] || '';
    return `<td><input class="custom-cell" data-client="${item.id}" data-column="${column.id}" type="${inputType}" placeholder="—" value="${escapeHtml(value)}"></td>`;
  }).join('');
}

/** Plain lowercase text used for client-side search filtering (see applyDashboardFilter in main.js). */
function searchIndex(item) {
  return escapeHtml([item.name, item.phone, item.email, item.contactLink].filter(Boolean).join(' ').toLowerCase());
}

function clientRow(item, columns) {
  const checked = uiState.selectedClientIds.has(item.id) ? 'checked' : '';
  return `<tr draggable="true" data-row-id="${item.id}" data-search="${searchIndex(item)}">
    <td><input type="checkbox" class="row-select" data-row-select="${item.id}" ${checked} aria-label="Вибрати ${escapeHtml(item.name)}"></td>
    <td class="drag-handle" title="Перетягніть, щоб змінити порядок">⋮⋮</td>
    <td class="row-actions">
      <button class="icon" data-edit-client="${item.id}" title="Редагувати">✎</button>
      <button class="icon" data-hide-client="${item.id}" title="Приховати (перемістити в Неактивні)">🗄</button>
      <button class="icon" data-delete-client="${item.id}" title="Видалити безповоротно">🗑</button>
    </td>
    <td>${escapeHtml(item.status || 'Працюємо')}</td>
    <td><button type="button" class="link-cell" data-view-client="${item.id}" title="Швидкий перегляд картки">${escapeHtml(item.name)}</button></td>
    <td>${escapeHtml(item.group || '—')}</td>
    <td>${rateText(item)}</td>
    <td>${escapeHtml(item.currency || 'немає')}</td>
    <td>${phoneLines(item.phone)}</td>
    <td>${escapeHtml(item.email || '—')}</td>
    <td>${contactLinkHtml(item)}</td>
    <td>${escapeHtml(item.bankAccess || '—')}</td>
    <td>${escapeHtml(item.prro || '—')}</td>
    <td>${escapeHtml(item.employees || '—')}</td>
    <td class="right">${moneyFormat.format(toNumber(item.serviceCost))}</td>
    <td>${escapeHtml(item.kepIssuer || '—')}</td>
    <td>${kepStatusLabel(item.kepExpiry)}</td>
    ${customColumnCells(item, columns)}
  </tr>`;
}

function bulkBarHtml(selectedCount) {
  return `<div class="bulk-bar" id="bulkBar" ${selectedCount ? '' : 'hidden'}>
    <span>Вибрано: <strong id="bulkCount">${selectedCount}</strong></span>
    <button class="secondary" data-bulk-export>Експорт вибраних</button>
    <button class="secondary" data-bulk-hide>Приховати вибрані</button>
    <button class="danger" data-bulk-delete>Видалити вибрані</button>
    <button class="link" data-bulk-clear>Зняти виділення</button>
  </div>`;
}

export function renderDashboard() {
  const columns = getCustomColumns();
  const clients = getVisibleClients();
  const rows = clients.map((item) => clientRow(item, columns));
  const headings = [
    '<input type="checkbox" id="selectAllRows" aria-label="Вибрати всі видимі рядки">', '', 'Дії', 'Статус', 'ПІБ', 'Група', 'Ставка', 'Валюта', 'Телефон', 'Ел. пошта', 'Зв\'язок',
    'Банк', 'П/РРО', 'Наймані', 'Обслуговування', 'Видавець КЕП', 'КЕП дійсний',
    ...columns.map(customColumnHeader),
  ];
  return `<div class="toolbar">
      <p class="note">Клікніть на ПІБ для швидкої картки, ✎ — для редагування. Перетягніть рядок за ⋮⋮, щоб змінити порядок — він застосується і в «Оплатах».</p>
      <div class="toolbar-actions">
        <input type="search" id="dashboardSearch" class="search-input" placeholder="Пошук за ПІБ, телефоном, поштою… (Ctrl+/)" aria-label="Пошук ФОП">
        <button class="secondary" data-export-clients>Експорт</button>
        <button class="secondary" data-import-clients>Імпортувати з Excel</button>
        <input type="file" id="importFile" accept=".xlsx,.xls,.csv" hidden>
        <button class="secondary" data-add-column>+ Нова колонка</button>
      </div>
    </div>
    ${bulkBarHtml(clients.filter((item) => uiState.selectedClientIds.has(item.id)).length)}
    ${table(rows, headings)}`;
}

