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
import { rateText, phoneLines, contactLinkHtml, kepStatusLabel } from '../client-model';
import { table } from './layout.js';
import { getVisibleClients, getCustomColumns } from '../state.js';

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

function clientRow(item, columns) {
  return `<tr draggable="true" data-row-id="${item.id}">
    <td class="drag-handle" title="Перетягніть, щоб змінити порядок">⋮⋮</td>
    <td class="row-actions">
      <button class="icon" data-open-card="${item.id}" title="Редагувати">✎</button>
    </td>
    <td><button type="button" class="link-cell" data-open-card="${item.id}"><strong>${escapeHtml(item.name)}</strong></button></td>
    <td>${escapeHtml(item.group || '—')}</td>
    <td>${rateText(item)}</td>
    <td>${escapeHtml(item.currency || 'немає')}</td>
    <td>${phoneLines(item.phone)}</td>
    <td>${escapeHtml(item.email || '—')}</td>
    <td>${contactLinkHtml(item)}</td>
    <td>${escapeHtml(item.bankAccess || '—')}</td>
    <td>${escapeHtml(item.prro || '—')}</td>
    <td>${escapeHtml(item.employeesCount || '—')}</td>
    <td class="right">${moneyFormat.format(toNumber(item.serviceCost))}</td>
    <td>${escapeHtml(item.kepIssuer || '—')}</td>
    <td>${kepStatusLabel(item.kepExpiry)}</td>
    ${customColumnCells(item, columns)}
  </tr>`;
}

export function renderDashboard() {
  const columns = getCustomColumns();
  const clients = getVisibleClients();
  const rows = clients.map((item) => clientRow(item, columns));
  const headings = [
    '', 'Дії', 'ПІБ', 'Група', 'Ставка', 'Валюта', 'Телефон', 'Ел. пошта', 'Зв\'язок',
    'Банк', 'П/РРО', 'Наймані', 'Обслуговування', 'Видавець КЕП', 'КЕП дійсний',
    ...columns.map(customColumnHeader),
  ];
  return `<div class="toolbar">
      <p class="note">Клікніть на ПІБ або ✎, щоб відкрити картку клієнта. Перетягніть рядок за ⋮⋮, щоб змінити порядок — він застосується і в «Оплатах».</p>
      <div class="toolbar-actions">
        <button class="secondary" data-export-clients>Експорт</button>
        <button class="secondary" data-import-clients>Імпортувати з Excel</button>
        <input type="file" id="importFile" accept=".xlsx,.xls,.csv" hidden>
        <button class="secondary" data-add-column>+ Нова колонка</button>
      </div>
    </div>
    ${table(rows, headings)}`;
}
