// render/payments.js
// Builds the "Оплати" matrix: one row per active client, 12 months x
// (charged, paid) columns, with ПІБ + total debt frozen on the left.

import { escapeHtml, moneyFormat, MONTH_NAMES_UA, monthPeriodKey } from '../utils';
import { getVisibleClients, getClientMonthlyTotals, getMonthlyCellValue, getSettings } from '../state.js';
import { empty } from './layout.js';
import { uiState } from '../ui-state.js';
import { shortClientName } from '../client-model.js';

const monthsFor = (workingYear) => Array.from({ length: 12 }, (_, index) => ({
  key: monthPeriodKey(workingYear, index + 1),
  label: MONTH_NAMES_UA[index],
}));

/** Frozen-column width in px (ПІБ + Загальний борг) — kept in sync with matrix.css. */
export const STICKY_COLUMNS_WIDTH = 190 + 125;

function amountInput(item, monthKey, type) {
  const value = getMonthlyCellValue(item.id, monthKey, type) ?? '-';
  return `<td><input class="month-value" inputmode="decimal" data-client="${escapeHtml(item.id)}" data-month="${escapeHtml(monthKey)}" data-type="${escapeHtml(type)}" value="${escapeHtml(value)}" aria-label="${escapeHtml(type)} ${escapeHtml(monthKey)} для ${escapeHtml(item.name)}"></td>`;
}

export function renderPayments() {
  const workingYear = getSettings().workingYear;
  const allMonths = monthsFor(workingYear);
  if (![1, 2, 3, 4].includes(uiState.paymentsQuarter)) uiState.paymentsQuarter = new Date().getFullYear() === workingYear ? Math.floor(new Date().getMonth() / 3) + 1 : 1;
  const months = allMonths.slice((uiState.paymentsQuarter - 1) * 3, uiState.paymentsQuarter * 3);
  const clients = getVisibleClients();
  const rows = clients.map((item) => {
    const totals = getClientMonthlyTotals(item.id);
    const monthCells = months.map((month) => `${amountInput(item, month.key, 'charged')}${amountInput(item, month.key, 'paid')}`).join('');
    return `<tr>
      <td class="fop-name"><strong>${escapeHtml(shortClientName(item.name))}</strong></td>
      <td class="right amount debt">${moneyFormat.format(totals.charged - totals.paid)}</td>
      ${monthCells}
    </tr>`;
  });
  const monthHeadRow = months.map((month) => `<th colspan="2" class="month-head">${month.label}</th>`).join('');
  const subHeadRow = months.map(() => '<th>Нарах.</th><th>Сплач.</th>').join('');
  const body = rows.length
    ? rows.join('')
    : `<tr><td colspan="${2 + months.length * 2}">${empty('Додайте ФОП на сторінці «Огляд».')}</td></tr>`;
  return `<div class="toolbar"><p class="note">Для кожного ФОП — нараховано і сплачено по місяцях ${workingYear} року. Вкажіть суму або «-». Зміни зберігаються після виходу з поля.</p></div><div class="subnav">${[1,2,3,4].map((quarter) => `<button class="tab ${quarter === uiState.paymentsQuarter ? 'active' : ''}" data-payments-quarter="${quarter}">${quarter} квартал</button>`).join('')}</div>
    <div class="table-wrap payments-matrix">
      <table class="table">
        <thead>
          <tr><th rowspan="2" class="fop-name">ПІБ</th><th rowspan="2" class="debt">Загальний борг</th>${monthHeadRow}</tr>
          <tr>${subHeadRow}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/** Scroll the payments matrix so ~5 months (2 before, current, 2 after) are visible by default. */
export function positionPaymentsTable() {
  const wrapper = document.querySelector('.payments-matrix');
  if (!wrapper) return;
  const now = new Date();
  const workingYear = getSettings().workingYear;
  const months = monthsFor(workingYear);
  const currentIndex = now.getFullYear() === workingYear ? now.getMonth() : (now.getFullYear() < workingYear ? 0 : 11);
  const startIndex = Math.max(0, Math.min(currentIndex - 2, months.length - 5));
  const startMonth = months[startIndex].key;
  const target = wrapper.querySelector(`[data-month="${startMonth}"][data-type="charged"]`);
  if (!target) return;
  wrapper.scrollLeft = Math.max(0, target.offsetLeft - wrapper.offsetLeft - STICKY_COLUMNS_WIDTH);
}
