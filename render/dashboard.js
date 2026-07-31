// render/dashboard.js
// Builds the "Картки клієнтів" table: one row per active client, з
// перетягуванням для зміни порядку, кастомними колонками та клікабельним
// ім'ям/іконкою ✎, що відкривають Картку клієнта (client-card-ui.js).
//
// Етап 2: прибрано колонку "Статус" (за проханням користувача) та
// прибрано чекбокси/пошук/bulk-панель, які були начеркані в попередній
// версії цього файлу, але ніколи не мали робочої прив'язки подій (в
// живому app.js їх не було) — щоб не вносити недороблену функціональність
// під час структурної міграції. Це можна додати окремим, свідомим кроком.

import { escapeHtml, moneyFormat, toNumber } from '../utils';
import { rateText, phoneLines, kepStatusLabel, shortClientName } from '../client-model';
import { table } from './layout.js';
import { getVisibleClients, getCustomColumns } from '../state.js';
import { uiState } from '../ui-state.js';

const FILTER_COLUMNS = [
  ['name', 'ПІБ'], ['groupRate', 'Група / ставка'], ['currency', 'Валюта'], ['phone', 'Телефон'], ['email', 'Ел. пошта'], ['bankAccess', 'Банк'], ['prro', 'П/РРО'], ['employees', 'Наймані'], ['serviceCost', 'Обслуговування'], ['kepIssuer', 'Видавець КЕП'], ['kepExpiry', 'КЕП дійсний'],
];

function filterValue(item, key) {
  if (key.startsWith('custom:')) return item.customFields?.[key.slice(7)] || '';
  return {
    name: item.name || '', groupRate: `${item.group || '-'} / ${rateText(item)}`,
    currency: item.currency || '-', phone: item.phone || '', email: item.email || '',
    bankAccess: item.bankAccess || '', prro: item.prro || '', employees: String(item.employeesCount || ''),
    serviceCost: String(toNumber(item.serviceCost) || ''), kepIssuer: item.kepIssuer || '',
    kepExpiry: kepStatusLabel(item.kepExpiry).replace(/<[^>]*>/g, ''),
  }[key] ?? '';
}

function filterMenu(label, key, clients) {
  if (uiState.dashboardFilterOpen !== key) return '';
  const active = (uiState.dashboardFilters[key] || []).length;
  const options = [...new Set(clients.map((item) => filterValue(item, key)))].sort((a, b) => String(a).localeCompare(String(b), 'uk'));
  const selected = new Set(uiState.dashboardFilters[key] || options);
  return `<div class="dashboard-filter-menu" data-dashboard-filter-menu data-filter-key="${escapeHtml(key)}">
    <div class="filter-menu-title">Фільтр: ${escapeHtml(label)}</div>
    <label class="filter-select-all"><input type="checkbox" data-filter-select-all ${options.every((value) => selected.has(value)) ? 'checked' : ''}> Обрати все</label>
    <div class="filter-options">${options.map((value) => `<label><input type="checkbox" data-filter-option value="${escapeHtml(value)}" ${selected.has(value) ? 'checked' : ''}> ${escapeHtml(value || '-')}</label>`).join('') || '<span class="muted">Немає значень</span>'}</div>
    <div class="filter-menu-actions"><button type="button" class="secondary" data-close-dashboard-filter>Скасувати</button><button type="button" class="primary" data-apply-dashboard-filter>Застосувати</button></div>
  </div>`;
}

function filterHeader(label, key, controls = '') {
  const active = (uiState.dashboardFilters[key] || []).length;
  return `<span class="dashboard-header-label">${escapeHtml(label)}<button type="button" class="table-filter-button${active ? ' active' : ''}" data-dashboard-filter="${escapeHtml(key)}" title="Фільтр: ${escapeHtml(label)}" aria-label="Фільтр: ${escapeHtml(label)}">▾</button>${controls}</span>`;
}

function customColumnHeader(column) {
  const controls = `<button class="column-control" data-edit-column="${column.id}" title="Змінити назву">✎</button><button class="column-control" data-delete-column="${column.id}" title="Видалити колонку">×</button>`;
  return filterHeader(column.name, `custom:${column.id}`, controls);
}

function customColumnCells(item, columns) {
  return columns.map((column) => {
    const inputType = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
    const value = item.customFields?.[column.id] || '';
    return `<td><input class="custom-cell" data-client="${item.id}" data-column="${column.id}" type="${inputType}" placeholder="-" value="${escapeHtml(value)}"></td>`;
  }).join('');
}

function clientRow(item, columns) {
  return `<tr data-client-row data-row-id="${item.id}">
    <td class="drag-cell"><span class="drag-handle" data-drag-handle title="Перетягніть, щоб змінити порядок" role="button" aria-label="Змінити порядок ФОП">⋮⋮</span></td>
    <td><button type="button" class="link-cell" data-open-card="${item.id}"><strong>${escapeHtml(shortClientName(item.name))}</strong></button></td>
    <td>${escapeHtml(item.group || '-')} / ${rateText(item)}</td>
    <td>${escapeHtml(item.currency || '-')}</td>
    <td>${phoneLines(item.phone)}</td>
    <td>${escapeHtml(item.email || '-')}</td>
    <td>${escapeHtml(item.bankAccess || '-')}</td>
    <td>${escapeHtml(item.prro || '-')}</td>
    <td>${escapeHtml(item.employeesCount || '-')}</td>
    <td class="right">${moneyFormat.format(toNumber(item.serviceCost))}</td>
    <td>${escapeHtml(item.kepIssuer || '-')}</td>
    <td>${kepStatusLabel(item.kepExpiry)}</td>
    ${customColumnCells(item, columns)}
  </tr>`;
}

export function renderDashboard() {
  const columns = getCustomColumns();
  const allClients = getVisibleClients();
  const clients = allClients.filter((item) => Object.entries(uiState.dashboardFilters).every(([key, selected]) => selected.includes(filterValue(item, key))));
  const rows = clients.map((item) => clientRow(item, columns));
  const openColumn = [...FILTER_COLUMNS, ...columns.map((column) => [`custom:${column.id}`, column.name])].find(([key]) => key === uiState.dashboardFilterOpen);
  const headings = [
    '', ...FILTER_COLUMNS.map(([key, label]) => filterHeader(label, key)),
    ...columns.map(customColumnHeader),
  ];
  return `<div class="toolbar">
      <p class="note">Клікніть на ПІБ, щоб відкрити картку клієнта. Перетягніть рядок за ⋮⋮, щоб змінити порядок — він застосується і в «Оплатах».</p>
      <div class="toolbar-actions">
        <button class="secondary" data-export-clients>Експорт</button>
        <button class="secondary" data-import-clients>Імпорт</button>
        <button class="secondary" data-check-all-kved>Перевірити всі КВЕД</button>
        <input type="file" id="importFile" accept=".xlsx,.xls,.csv" hidden>
        <button class="primary" data-add-client>+ Додати ФОП</button>
      </div>
    </div>
    ${openColumn ? `<div class="dashboard-filter-area">${filterMenu(openColumn[1], openColumn[0], allClients)}</div>` : ''}
    ${table(rows.length ? rows : [`<tr><td colspan="${headings.length}" class="empty-cell">За обраними фільтрами записів немає.</td></tr>`], headings, 'dashboard-table')}`;
}
