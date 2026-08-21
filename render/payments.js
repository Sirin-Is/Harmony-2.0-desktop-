// render/payments.js
// Builds the "Оплати" matrix: one row per active client, all 12 months x
// (charged, paid) columns, with ПІБ + total debt frozen on the left.

import { escapeHtml, moneyFormat, MONTH_NAMES_UA, monthPeriodKey } from '../utils';
import { getVisibleClients, getClientMonthlyTotals, getMonthlyCellValue, getSettings } from '../state.js';
import { empty } from './layout.js';
import { shortClientName } from '../client-model.js';
import { formatEditableAmount } from '../money-validation.js';

const monthsFor = (workingYear) => Array.from({ length: 12 }, (_, index) => ({
  key: monthPeriodKey(workingYear, index + 1),
  label: MONTH_NAMES_UA[index],
}));

function amountInput(item, monthKey, type) {
  const value = formatEditableAmount(getMonthlyCellValue(item.id, monthKey, type));
  const typeLabel = type === 'charged' ? 'Нараховано' : 'Сплачено';
  return `<td><input class="month-value" inputmode="decimal" data-client="${escapeHtml(item.id)}" data-month="${escapeHtml(monthKey)}" data-type="${escapeHtml(type)}" value="${escapeHtml(value)}" aria-label="${typeLabel}, ${escapeHtml(monthKey)}, ${escapeHtml(item.name)}"></td>`;
}

function paidCheckbox(item, monthKey) {
  const charged = getMonthlyCellValue(item.id, monthKey, 'charged');
  const paid = getMonthlyCellValue(item.id, monthKey, 'paid');
  const hasCharge = charged !== undefined && charged !== '' && charged !== '-';
  const checked = hasCharge && String(charged) === String(paid);
  return `<td class="month-paid-cell"><input type="checkbox" class="month-paid-check" data-client="${escapeHtml(item.id)}" data-month="${escapeHtml(monthKey)}" ${checked ? 'checked' : ''} ${hasCharge ? '' : 'disabled'} aria-label="Сплачено повністю, ${escapeHtml(monthKey)}, ${escapeHtml(item.name)}"></td>`;
}

export function renderPayments() {
  const workingYear = getSettings().workingYear;
  const months = monthsFor(workingYear);
  const clients = getVisibleClients();
  const rows = clients.map((item) => {
    const totals = getClientMonthlyTotals(item.id);
    const monthCells = months.map((month) => `${amountInput(item, month.key, 'charged')}${paidCheckbox(item, month.key)}`).join('');
    return `<tr>
      <td class="fop-name"><strong>${escapeHtml(shortClientName(item.name))}</strong></td>
      <td class="right amount debt">${moneyFormat.format(totals.charged - totals.paid)}</td>
      ${monthCells}
    </tr>`;
  });
  const monthHeadRow = months.map((month) => `<th colspan="2" class="month-head">${month.label}<button type="button" class="auto-charge" data-autofill-month="${escapeHtml(month.key)}" title="Заповнити «Нарах.» за вартістю обслуговування в картках ФОП">Авто</button></th>`).join('');
  const subHeadRow = months.map(() => '<th>Нарах.</th><th class="month-boundary">Сплач.</th>').join('');
  const body = rows.length
    ? rows.join('')
    : `<tr><td colspan="${2 + months.length * 2}">${empty('Додайте ФОП на сторінці «Огляд».')}</td></tr>`;
  return `<div class="table-wrap payments-matrix">
      <table class="table">
        <thead>
          <tr><th rowspan="2" class="fop-name">ПІБ</th><th rowspan="2" class="debt">Загальний борг</th>${monthHeadRow}</tr>
          <tr>${subHeadRow}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
