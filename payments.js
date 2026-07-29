// render/payments.js
// Builds the "Оплати" matrix: one row per active client, 12 months x
// (charged, paid) columns, with ПІБ + total debt frozen on the left.

import { escapeHtml, moneyFormat, MONTH_NAMES_UA, PAYMENT_YEAR } from '../utils.js';
import { getVisibleClients, getClientMonthlyTotals, getMonthlyCellValue } from '../state.js';
import { empty } from './layout.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  key: `${PAYMENT_YEAR}-${String(index + 1).padStart(2, '0')}`,
  label: MONTH_NAMES_UA[index],
}));

/** Frozen-column width in px (ПІБ + Загальний борг) — kept in sync with matrix.css. */
export const STICKY_COLUMNS_WIDTH = 190 + 125;

function amountInput(item, monthKey, type) {
  const value = getMonthlyCellValue(item.id, monthKey, type) ?? '-';
  return `<td><input class="month-value" inputmode="decimal" data-client="${item.id}" data-month="${monthKey}" data-type="${type}" value="${escapeHtml(value)}" aria-label="${type} ${monthKey} для ${escapeHtml(item.name)}"></td>`;
}

export function renderPayments() {
  const clients = getVisibleClients();
  const rows = clients.map((item) => {
    const totals = getClientMonthlyTotals(item.id);
    const monthCells = MONTHS.map((month) => `${amountInput(item, month.key, 'charged')}${amountInput(item, month.key, 'paid')}`).join('');
    return `<tr>
      <td class="fop-name"><strong>${escapeHtml(item.name)}</strong></td>
      <td class="right amount debt">${moneyFormat.format(totals.charged - totals.paid)}</td>
      ${monthCells}
    </tr>`;
  });
  const monthHeadRow = MONTHS.map((month) => `<th colspan="2" class="month-head">${month.label}</th>`).join('');
  const subHeadRow = MONTHS.map(() => '<th>Нарах.</th><th>Сплач.</th>').join('');
  const body = rows.length
    ? rows.join('')
    : `<tr><td colspan="${2 + MONTHS.length * 2}">${empty('Додайте ФОП на сторінці «Огляд».')}</td></tr>`;
  return `<div class="toolbar"><p class="note">Для кожного ФОП — нараховано і сплачено по місяцях ${PAYMENT_YEAR} року. Вкажіть суму або «-». Зміни зберігаються після виходу з поля.</p></div>
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
  const currentIndex = now.getFullYear() === PAYMENT_YEAR ? now.getMonth() : (now.getFullYear() < PAYMENT_YEAR ? 0 : 11);
  const startIndex = Math.max(0, Math.min(currentIndex - 2, MONTHS.length - 5));
  const startMonth = MONTHS[startIndex].key;
  const target = wrapper.querySelector(`[data-month="${startMonth}"][data-type="charged"]`);
  if (!target) return;
  wrapper.scrollLeft = Math.max(0, target.offsetLeft - wrapper.offsetLeft - STICKY_COLUMNS_WIDTH);
}
