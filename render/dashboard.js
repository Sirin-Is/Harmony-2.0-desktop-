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
import { rateText, phoneLines, kepDaysLabel, kepStatusLabel, shortClientName } from '../client-model';
import { table } from './layout.js';
import { getVisibleClients, getCustomColumns } from '../state.js';
import { uiState } from '../ui-state.js';

const FILTER_COLUMNS = [
  ['name', 'ПІБ'], ['groupRate', 'Група / ставка'], ['currency', 'Валюта'], ['phone', 'Телефон'], ['bankAccess', 'Банк'], ['prro', 'П/РРО'], ['employees', 'Наймані'], ['serviceCost', 'Вартість'], ['kepIssuer', 'КЕП від:'], ['kepExpiry', 'Дійсний'],
];

function filterValue(item, key) {
  if (key.startsWith('custom:')) return item.customFields?.[key.slice(7)] || '';
  return {
    name: item.name || '', groupRate: `${item.group || '-'} / ${rateText(item)}`,
    currency: item.currency || '-', phone: item.phone || '',
    bankAccess: item.bankAccess || '', prro: item.prro || '', employees: Number(item.employeesCount) > 0 ? String(item.employeesCount) : '-',
    serviceCost: String(toNumber(item.serviceCost) || ''), kepIssuer: item.kepIssuer || '',
    kepExpiry: kepDaysLabel(item.kepExpiry),
  }[key] ?? '';
}

function filterMenu(label, key, clients) {
  if (uiState.dashboardFilterOpen !== key) return '';
  const options = [...new Set(clients.map((item) => filterValue(item, key)))].sort((a, b) => String(a).localeCompare(String(b), 'uk'));
  const selected = new Set(uiState.dashboardFilters[key] || options);
  const sorting = key === 'name' ? `<label class="filter-sort">Сортування<select data-dashboard-sort><option value="manual" ${uiState.dashboardSort === 'manual' ? 'selected' : ''}>Вручну</option><option value="name-asc" ${uiState.dashboardSort === 'name-asc' ? 'selected' : ''}>А–Я</option><option value="name-desc" ${uiState.dashboardSort === 'name-desc' ? 'selected' : ''}>Я–А</option></select></label>` : key === 'serviceCost' ? `<label class="filter-sort">Сортування<select data-dashboard-sort><option value="manual" ${uiState.dashboardSort === 'manual' ? 'selected' : ''}>Вручну</option><option value="cost-asc" ${uiState.dashboardSort === 'cost-asc' ? 'selected' : ''}>Менша–більша</option><option value="cost-desc" ${uiState.dashboardSort === 'cost-desc' ? 'selected' : ''}>Більша–менша</option></select></label>` : '';
  return `<div class="dashboard-filter-menu" data-dashboard-filter-menu data-filter-key="${escapeHtml(key)}">
    <div class="filter-menu-title">Фільтр: ${escapeHtml(label)}</div>
    ${sorting}
    <label class="filter-select-all"><input type="checkbox" data-filter-select-all ${options.every((value) => selected.has(value)) ? 'checked' : ''}> Обрати все</label>
    <div class="filter-options">${options.map((value) => `<label><input type="checkbox" data-filter-option value="${escapeHtml(value)}" ${selected.has(value) ? 'checked' : ''}> ${escapeHtml(value || '-')}</label>`).join('') || '<span class="muted">Немає значень</span>'}</div>
    <div class="filter-menu-actions"><button type="button" class="secondary" data-close-dashboard-filter>Скасувати</button><button type="button" class="primary" data-apply-dashboard-filter>Застосувати</button></div>
  </div>`;
}

function filterHeader(label, key, controls = '') {
  const active = Object.hasOwn(uiState.dashboardFilters, key);
  return `<span class="dashboard-header-label">${escapeHtml(label)}<button type="button" class="table-filter-button${active ? ' active' : ''}" data-dashboard-filter="${escapeHtml(key)}" title="Фільтр: ${escapeHtml(label)}" aria-label="Фільтр: ${escapeHtml(label)}">▾</button>${controls}</span>`;
}

function customColumnHeader(column) {
  const controls = `<button class="column-control" data-edit-column="${escapeHtml(column.id)}" title="Змінити назву">✎</button><button class="column-control" data-delete-column="${escapeHtml(column.id)}" title="Видалити колонку">×</button>`;
  return filterHeader(column.name, `custom:${column.id}`, controls);
}

function customColumnCells(item, columns) {
  return columns.map((column) => {
    const inputType = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
    const value = item.customFields?.[column.id] || '';
    return `<td><input class="custom-cell" data-client="${escapeHtml(item.id)}" data-column="${escapeHtml(column.id)}" type="${inputType}" placeholder="-" value="${escapeHtml(value)}" aria-label="${escapeHtml(column.name)}: ${escapeHtml(item.name)}"></td>`;
  }).join('');
}

function clientRow(item, columns) {
  return `<tr data-client-row data-row-id="${escapeHtml(item.id)}">
    <td class="drag-cell"><span class="drag-handle" data-drag-handle title="Перетягніть або використайте стрілки ↑ ↓" role="button" tabindex="0" aria-keyshortcuts="ArrowUp ArrowDown" aria-label="Змінити порядок ФОП: стрілка вгору або вниз">⋮⋮</span></td>
    <td><button type="button" class="link-cell" data-open-card="${escapeHtml(item.id)}"><strong>${escapeHtml(shortClientName(item.name))}</strong></button></td>
    <td>${escapeHtml(item.group || '-')} / ${rateText(item)}</td>
    <td>${escapeHtml(item.currency || '-')}</td>
    <td>${phoneLines(item.phone)}</td>
    <td>${escapeHtml(item.bankAccess || '-')}</td>
    <td>${escapeHtml(item.prro || '-')}</td>
    <td>${Number(item.employeesCount) > 0 ? escapeHtml(item.employeesCount) : '-'}</td>
    <td class="right">${moneyFormat.format(toNumber(item.serviceCost))}</td>
    <td>${escapeHtml(item.kepIssuer || '-')}</td>
    <td>${kepStatusLabel(item.kepExpiry)}</td>
    ${customColumnCells(item, columns)}
  </tr>`;
}

export function renderDashboard() {
  const columns = getCustomColumns();
  const allClients = getVisibleClients();
  const search = String(uiState.dashboardSearch || '').trim().toLocaleLowerCase('uk');
  const clients = allClients.filter((item) => {
    const matchesFilters = Object.entries(uiState.dashboardFilters).every(([key, selected]) => selected.includes(filterValue(item, key)));
    if (!matchesFilters || !search) return matchesFilters;
    const values = [...FILTER_COLUMNS.map(([key]) => filterValue(item, key)), ...columns.map((column) => filterValue(item, `custom:${column.id}`))];
    return values.some((value) => String(value).toLocaleLowerCase('uk').includes(search));
  });
  const sortedClients = [...clients].sort((a, b) => {
    if (uiState.dashboardSort === 'name-desc') return String(b.name).localeCompare(String(a.name), 'uk');
    if (uiState.dashboardSort === 'cost-asc') return toNumber(a.serviceCost) - toNumber(b.serviceCost) || String(a.name).localeCompare(String(b.name), 'uk');
    if (uiState.dashboardSort === 'cost-desc') return toNumber(b.serviceCost) - toNumber(a.serviceCost) || String(a.name).localeCompare(String(b.name), 'uk');
    return 0;
  });
  const rows = sortedClients.map((item) => clientRow(item, columns));
  const openColumn = [...FILTER_COLUMNS, ...columns.map((column) => [`custom:${column.id}`, column.name])].find(([key]) => key === uiState.dashboardFilterOpen);
  const activeFilterCount = Object.keys(uiState.dashboardFilters).length;
  const hasQuery = Boolean(search || activeFilterCount);
  const headings = [
    '', ...FILTER_COLUMNS.map(([key, label]) => filterHeader(label, key)),
    ...columns.map(customColumnHeader),
  ];
  return `<div class="toolbar">
      <div class="toolbar-actions">
        <label class="dashboard-search"><span class="visually-hidden">Швидкий пошук ФОП</span><input type="search" data-dashboard-search value="${escapeHtml(uiState.dashboardSearch || '')}" placeholder="Пошук ФОП…" autocomplete="off"></label>
        <span class="dashboard-result-count" aria-live="polite">${clients.length} із ${allClients.length}</span>
        ${activeFilterCount ? `<button class="secondary compact-action" data-clear-dashboard-filters>Скинути фільтри (${activeFilterCount})</button>` : ''}
        <button class="secondary" data-export-clients>Експорт</button>
        <button class="secondary" data-import-clients>Імпорт</button>
        <input type="file" id="importFile" accept=".xlsx,.xls,.csv" hidden>
        <button class="primary" data-add-client>+ Додати ФОП</button>
      </div>
    </div>
    ${openColumn ? `<div class="dashboard-filter-area">${filterMenu(openColumn[1], openColumn[0], allClients)}</div>` : ''}
    ${table(rows.length ? rows : [`<tr><td colspan="${headings.length}" class="empty-cell">${hasQuery ? 'За пошуком або вибраними фільтрами записів немає.' : 'Активних ФОП поки немає.'}</td></tr>`], headings, 'dashboard-table')}`;
}
