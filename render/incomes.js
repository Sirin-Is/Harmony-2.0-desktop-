// render/incomes.js
// Builds the "Доходи" tab: one unified matrix for every active ФОП.
// "Залишок ліміту" = the active group's limit minus income since the
// beginning of the selected year.

import { escapeHtml, moneyFormat, MONTH_SHORT_UA, monthPeriodKey } from '../utils';
import { getVisibleClients, incomeSum, getIncomeValue, getSettings } from '../state.js';
import { groupLimitAmount } from '../client-model';
import { shortClientName } from '../client-model.js';
import { formatEditableAmount } from '../money-validation.js';

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

export function renderIncomes() {
  const workingYear = getSettings().workingYear;
  const clients = getVisibleClients();

  const cell = (item, index) => incomeCell(item, monthPeriodKey(workingYear, index + 1));

  const headings = ['ПІБ', 'Залишок ліміту', ...MONTH_SHORT_UA];
  const rows = clients.map((item) => {
    const ytd = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], workingYear);
    const monthCells = Array.from({ length: 12 }, (_, index) => cell(item, index)).join('');
    return `<tr data-row-id="${escapeHtml(item.id)}"><td class="fop-name"><strong>${escapeHtml(shortClientName(item.name))}</strong></td><td class="right income-limit-cell">${remainingLimitLabel(item.group, ytd)}</td>${monthCells}</tr>`;
  });
  const headCells = headings.map((h, index) => `<th class="${index === 0 ? 'fop-name' : index === 1 ? 'income-limit-cell' : ''}">${h}</th>`).join('');
  const body = clients.length
    ? `<div class="table-wrap incomes-matrix"><table class="table income-group-all"><thead><tr>${headCells}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<p class="empty">Активних ФОП поки немає.</p>`;

  return `<div class="subnav section-control-row section-control-row-primary income-main-nav"><div class="toolbar-actions"><span class="report-year-label">${workingYear}</span><button class="secondary" data-import-incomes>Імпорт</button><input id="incomeImportFile" type="file" accept=".xlsx,.xls,.csv" hidden></div></div>
    ${body}`;
}
