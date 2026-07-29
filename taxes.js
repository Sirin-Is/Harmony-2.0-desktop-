// render/taxes.js
// Builds the "Податки" tab: group (1/2/3) and period sub-navigation, and
// a table with three rows per client (Єдиний податок / Військовий збір / ЄСВ).

import { escapeHtml } from '../utils.js';
import { getTaxField, getClientsByGroup } from '../state.js';
import { TAX_TYPES, TAX_GROUPS, taxPeriodsFor, exemptionOptions, statusPillHtml, daysUntilLabel, previousPeriodKey } from '../tax-model.js';
import { table, empty } from './layout.js';
import { uiState } from '../ui-state.js';

function exemptionSelect(item, taxType, record) {
  const options = exemptionOptions(uiState.taxGroup).map((opt) =>
    `<option value="${escapeHtml(opt)}" ${record.exemption === opt ? 'selected' : ''}>${opt || '—'}</option>`,
  ).join('');
  return `<select class="tax-field" data-client="${item.id}" data-tax="${taxType.key}" data-field="exemption">${options}</select>`;
}

function taxRow(item, taxType, index, record) {
  const nameCell = index === 0 ? `<td rowspan="3" class="fop-name-cell">${escapeHtml(item.name)}</td>` : '';
  return `<tr class="${record.exemption ? 'exempt-row' : ''}">
    ${nameCell}
    <td>${taxType.label}</td>
    <td><input type="date" class="tax-field" data-client="${item.id}" data-tax="${taxType.key}" data-field="queuedDate" value="${escapeHtml(record.queuedDate || '')}"></td>
    <td><input type="date" class="tax-field" data-client="${item.id}" data-tax="${taxType.key}" data-field="paidDate" value="${escapeHtml(record.paidDate || '')}"></td>
    <td class="tax-days">${daysUntilLabel(record.deadline)}</td>
    <td><input type="date" class="tax-field" data-client="${item.id}" data-tax="${taxType.key}" data-field="deadline" value="${escapeHtml(record.deadline || '')}"></td>
    <td class="tax-status">${statusPillHtml(record)}</td>
    <td>${exemptionSelect(item, taxType, record)}</td>
    <td><input type="text" class="tax-field" data-client="${item.id}" data-tax="${taxType.key}" data-field="note" placeholder="Примітка" value="${escapeHtml(record.note || '')}"></td>
  </tr>`;
}

export function renderTaxes() {
  if (!TAX_GROUPS.some((g) => g.key === uiState.taxGroup)) uiState.taxGroup = '1';
  const periods = taxPeriodsFor(uiState.taxGroup);
  if (!uiState.taxPeriod || !periods.some((p) => p.key === uiState.taxPeriod)) uiState.taxPeriod = periods[0].key;

  const clients = getClientsByGroup(uiState.taxGroup);
  const rows = [];
  clients.forEach((item) => {
    TAX_TYPES.forEach((taxType, index) => {
      const record = getTaxField(item.id, uiState.taxGroup, uiState.taxPeriod, taxType.key);
      rows.push(taxRow(item, taxType, index, record));
    });
  });

  const groupTabs = TAX_GROUPS.map((g) =>
    `<button class="tab ${g.key === uiState.taxGroup ? 'active' : ''}" data-tax-group="${g.key}">${g.label}</button>`,
  ).join('');
  const periodTabs = periods.map((p) =>
    `<button class="tab ${p.key === uiState.taxPeriod ? 'active' : ''}" data-tax-period="${p.key}">${p.label}</button>`,
  ).join('');
  const body = clients.length
    ? table(rows, ['ПІБ', 'Податок', 'Набрано в банку', 'Дата сплати', 'Днів до дедлайну', 'Дедлайн', 'Статус', 'Причина звільнення', 'Примітка'])
    : empty('У цій групі ще немає активних ФОП.');

  const hasPreviousPeriod = Boolean(previousPeriodKey(periods, uiState.taxPeriod));

  return `<div class="toolbar">
      <p class="note">Дедлайни не проставляються автоматично — вкажіть їх вручну або заповніть масово нижче. Якщо у ФОП є причина звільнення, рядок стає сірим і статус не показується.</p>
      <div class="toolbar-actions">
        <input type="date" id="taxBulkDeadline" aria-label="Дедлайн для всіх">
        <button class="secondary" data-bulk-set-deadline${clients.length ? '' : ' disabled'}>Дедлайн для всіх (${clients.length * TAX_TYPES.length})</button>
        <button class="secondary" data-copy-previous-period${hasPreviousPeriod && clients.length ? '' : ' disabled'} title="Переносить дедлайн і причину звільнення з попереднього періоду, тільки в порожні поля. Дати сплати ніколи не копіюються.">Скопіювати з попереднього періоду</button>
      </div>
    </div>
    <div class="subnav">${groupTabs}</div>
    <div class="subnav periods">${periodTabs}</div>
    ${body}`;
}
