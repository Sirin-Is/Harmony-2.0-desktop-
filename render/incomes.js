// render/incomes.js
// Builds the "Доходи" tab: one unified matrix for every active ФОП.
// "Залишок ліміту" = the active group's limit minus income since the
// beginning of the selected year.

import { escapeHtml, moneyFormat, MONTH_NAMES_UA, monthPeriodKey } from '../utils';
import { getVisibleClients, incomeSum, getIncomeValue, getSettings } from '../state.js';
import { groupLimitAmount } from '../client-model';
import { shortClientName } from '../client-model.js';
import { formatEditableAmount } from '../money-validation.js';
import { uiState } from '../ui-state.js';

function remainingLimitLabel(group, ytdIncome) {
  const limit = groupLimitAmount(group, getSettings().minWage);
  if (!limit) return '—';
  const remaining = limit - ytdIncome;
  const cls = remaining < 0 ? 'late' : remaining < limit * 0.1 ? 'warn' : 'ok';
  return `<span class="pill ${cls}">${moneyFormat.format(remaining)}</span>`;
}

function incomeCell(item, monthKey) {
  const value = getIncomeValue(item.id, monthKey);
  const display = formatEditableAmount(value);
  return `<td><input class="income-value" inputmode="decimal" data-client="${escapeHtml(item.id)}" data-month="${escapeHtml(monthKey)}" value="${escapeHtml(display)}" aria-label="Дохід ${escapeHtml(monthKey)} для ${escapeHtml(item.name)}"></td>`;
}

const QUARTERS = [
  { key: 1, label: 'I квартал', months: [0, 1, 2] },
  { key: 2, label: 'II квартал', months: [3, 4, 5] },
  { key: 3, label: 'III квартал', months: [6, 7, 8] },
  { key: 4, label: 'IV квартал', months: [9, 10, 11] },
];

export function renderIncomes() {
  const workingYear = getSettings().workingYear;
  const clients = getVisibleClients();
  const currentQuarter = new Date().getFullYear() === workingYear ? Math.floor(new Date().getMonth() / 3) + 1 : 1;
  if (!QUARTERS.some((quarter) => quarter.key === uiState.incomeQuarter)) uiState.incomeQuarter = currentQuarter;
  const quarter = QUARTERS.find((item) => item.key === uiState.incomeQuarter);
  const otherMonths = Array.from({ length: 12 }, (_, index) => index).filter((index) => !quarter.months.includes(index));
  const cell = (item, index) => incomeCell(item, monthPeriodKey(workingYear, index + 1));
  const headings = ['ПІБ', 'Залишок ліміту', ...quarter.months.map((index) => MONTH_NAMES_UA[index]), 'Сума за квартал'];
  const rows = clients.map((item) => {
    const otherIncome = incomeSum(item.id, otherMonths, workingYear);
    const quarterIncome = incomeSum(item.id, quarter.months, workingYear);
    const monthCells = quarter.months.map((index) => cell(item, index)).join('');
    const limit = groupLimitAmount(item.group, getSettings().minWage);
    return `<tr data-row-id="${escapeHtml(item.id)}" data-income-limit="${limit || ''}" data-income-outside-quarter="${otherIncome}"><td class="fop-name"><strong>${escapeHtml(shortClientName(item.name))}</strong></td><td class="right income-limit-cell">${remainingLimitLabel(item.group, otherIncome + quarterIncome)}</td>${monthCells}<td class="right income-quarter-sum">${moneyFormat.format(quarterIncome)}</td></tr>`;
  });
  const headCells = headings.map((h, index) => `<th class="${index === 0 ? 'fop-name' : index === 1 ? 'income-limit-cell' : index === headings.length - 1 ? 'income-quarter-sum' : ''}">${h}</th>`).join('');
  const body = clients.length
    ? `<div class="table-wrap incomes-matrix"><table class="table income-group-quarter"><thead><tr>${headCells}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<p class="empty">Активних ФОП поки немає.</p>`;
  const quarterTabs = QUARTERS.map((item) => `<button class="tab ${item.key === quarter.key ? 'active' : ''}" data-income-quarter="${item.key}">${item.label}</button>`).join('');

  return `<div class="subnav section-control-row section-control-row-primary income-main-nav"><div>${quarterTabs}</div><div class="toolbar-actions"><span class="report-year-label">${workingYear}</span><button class="secondary" data-import-incomes>Імпорт</button><input id="incomeImportFile" type="file" accept=".xlsx,.xls,.csv" hidden></div></div>
    ${body}`;
}
