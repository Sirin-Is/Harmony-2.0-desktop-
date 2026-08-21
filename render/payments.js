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

function serviceChargeToggle(item, monthKey) {
  const charged = getMonthlyCellValue(item.id, monthKey, 'charged');
  const paid = getMonthlyCellValue(item.id, monthKey, 'paid');
  const hasCharge = charged !== undefined && charged !== '' && charged !== '-';
  const active = hasCharge && String(charged) === String(paid);
  const value = formatEditableAmount(hasCharge ? charged : '');
  return `<td class="month-charge-cell"><button type="button" class="service-charge-toggle ${active ? 'is-active' : ''}" data-service-charge data-client="${escapeHtml(item.id)}" data-month="${escapeHtml(monthKey)}" data-active="${active}" data-value="${escapeHtml(String(hasCharge ? charged : ''))}" data-default-value="${escapeHtml(String(item.serviceCost ?? ''))}" aria-label="Оплата за ${escapeHtml(monthKey)}, ${escapeHtml(item.name)}" title="Натисніть, щоб позначити сплату; двічі швидко — щоб змінити суму">${escapeHtml(value)}</button></td>`;
}

export function renderPayments() {
  const workingYear = getSettings().workingYear;
  const months = monthsFor(workingYear);
  const clients = getVisibleClients();
  const rows = clients.map((item) => {
    const totals = getClientMonthlyTotals(item.id);
    const monthCells = months.map((month) => serviceChargeToggle(item, month.key)).join('');
    return `<tr>
      <td class="fop-name"><strong>${escapeHtml(shortClientName(item.name))}</strong></td>
      <td class="right amount debt">${moneyFormat.format(totals.charged - totals.paid)}</td>
      ${monthCells}
    </tr>`;
  });
  const monthHeadRow = months.map((month) => `<th class="month-head">${month.label}<button type="button" class="auto-charge" data-autofill-month="${escapeHtml(month.key)}" title="Заповнити за вартістю обслуговування в картках ФОП" aria-label="Автоматично заповнити ${month.label}">✓</button></th>`).join('');
  const body = rows.length
    ? rows.join('')
    : `<tr><td colspan="${2 + months.length}">${empty('Додайте ФОП на сторінці «Огляд».')}</td></tr>`;
  return `<div class="table-wrap payments-matrix">
      <table class="table">
        <thead>
          <tr><th class="fop-name">ПІБ</th><th class="debt">Загальний борг</th>${monthHeadRow}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
