// render/incomes.js
// Builds the "Доходи" tab: вкладки "1-2 група" / "3 група". Дохід
// вводиться помісячно; для 3 групи рахуються кумулятивні колонки
// (I квартал / Півріччя / 9 місяців / Рік). "Залишок ліміту" = ліміт
// групи (з Налаштувань) мінус накопичений дохід з початку року.

import { escapeHtml, moneyFormat, MONTH_SHORT_UA, monthPeriodKey } from '../utils';
import { getClientsByGroup, incomeSum, getIncomeValue, getSettings } from '../state.js';
import { groupLimitAmount } from '../client-model';
import { uiState } from '../ui-state.js';
import { shortClientName } from '../client-model.js';

function remainingLimitLabel(group, ytdIncome) {
  const limit = groupLimitAmount(group, getSettings().minWage);
  if (!limit) return '—';
  const remaining = limit - ytdIncome;
  const cls = remaining < 0 ? 'late' : remaining < limit * 0.1 ? 'warn' : 'ok';
  return `<span class="pill ${cls}">${moneyFormat.format(remaining)}</span>`;
}

function incomeCell(item, monthKey) {
  const value = getIncomeValue(item.id, monthKey);
  const display = value === undefined || value === null || value === '' ? '' : Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
  return `<td><input class="income-value" inputmode="decimal" data-client="${item.id}" data-month="${monthKey}" value="${escapeHtml(display)}" aria-label="Дохід ${monthKey} для ${escapeHtml(item.name)}"></td>`;
}

export function renderIncomes() {
  const workingYear = getSettings().workingYear;
  const groups = [{ key: '12', label: '1-2 група' }, { key: '3', label: '3 група' }];
  if (!groups.some((g) => g.key === uiState.incomeGroup)) uiState.incomeGroup = '12';
  const clients = uiState.incomeGroup === '12'
    ? [...getClientsByGroup('1'), ...getClientsByGroup('2')]
    : getClientsByGroup('3');

  const cell = (item, index) => incomeCell(item, monthPeriodKey(workingYear, index + 1));
  const sumCell = (value) => `<td class="right income-sum">${moneyFormat.format(value)}</td>`;

  let headings, rows;
  if (uiState.incomeGroup === '12') {
    headings = ['ПІБ', 'Залишок ліміту', ...MONTH_SHORT_UA];
    rows = clients.map((item) => {
      const ytd = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], workingYear);
      const monthCells = Array.from({ length: 12 }, (_, index) => cell(item, index)).join('');
      return `<tr data-row-id="${item.id}"><td class="fop-name"><strong>${escapeHtml(shortClientName(item.name))}</strong></td><td class="right income-limit-cell">${remainingLimitLabel(item.group, ytd)}</td>${monthCells}</tr>`;
    });
  } else {
    headings = ['ПІБ', 'Залишок ліміту', 'Січ', 'Лют', 'Бер', 'I кв.', 'Кві', 'Тра', 'Чер', 'Півріччя', 'Лип', 'Сер', 'Вер', '9 міс.', 'Жов', 'Лис', 'Гру', 'Рік'];
    rows = clients.map((item) => {
      const q1 = incomeSum(item.id, [0, 1, 2], workingYear);
      const half = incomeSum(item.id, [0, 1, 2, 3, 4, 5], workingYear);
      const m9 = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8], workingYear);
      const yearTotal = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], workingYear);
      const line = `${cell(item, 0)}${cell(item, 1)}${cell(item, 2)}${sumCell(q1)}${cell(item, 3)}${cell(item, 4)}${cell(item, 5)}${sumCell(half)}${cell(item, 6)}${cell(item, 7)}${cell(item, 8)}${sumCell(m9)}${cell(item, 9)}${cell(item, 10)}${cell(item, 11)}${sumCell(yearTotal)}`;
      return `<tr data-row-id="${item.id}"><td class="fop-name"><strong>${escapeHtml(shortClientName(item.name))}</strong></td><td class="right income-limit-cell">${remainingLimitLabel(item.group, yearTotal)}</td>${line}</tr>`;
    });
  }

  const groupTabs = groups.map((g) => `<button class="tab ${g.key === uiState.incomeGroup ? 'active' : ''}" data-income-group="${g.key}">${g.label}</button>`).join('');
  const headCells = headings.map((h, index) => `<th class="${index === 0 ? 'fop-name' : index === 1 ? 'income-limit-cell' : ''}">${h}</th>`).join('');
  const body = clients.length
    ? `<div class="table-wrap incomes-matrix"><table class="table"><thead><tr>${headCells}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : `<p class="empty">У цій групі ще немає активних ФОП.</p>`;

  return `<div class="toolbar"><p class="note">Дохід за місяць вводьте вручну. Стовпці кварталу/півріччя/9 місяців/року рахуються автоматично. «Залишок ліміту» = ліміт групи (з «Налаштувань») мінус накопичений дохід з початку року.</p></div>
    <div class="subnav">${groupTabs}</div>
    ${body}`;
}
