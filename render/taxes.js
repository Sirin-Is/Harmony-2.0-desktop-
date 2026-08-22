// render/taxes.js
// Builds the "Податки" tab: вкладки "1-2 група"/"3 група" (як у app.js —
// 1 і 2 групи мають однакові дедлайни й показані разом), період, і
// таблиця з трьома рядками на клієнта (Єдиний податок / Військовий збір / ЄСВ).

import { escapeHtml } from '../utils';
import { getTaxField, getClientsByTaxTab, getEffectiveTaxDeadline, getSettings } from '../state.js';
import { TAX_TYPES, TAX_GROUPS, taxPeriodsFor, exemptionOptions, statusPillHtml, daysUntilLabel, previousPeriodKey } from '../tax-model.ts';
import { shortClientName, groupAtPeriod } from '../client-model.js';
import { table, empty } from './layout.js';
import { uiState } from '../ui-state.js';

function exemptionSelect(item, taxType, record) {
  const options = exemptionOptions(uiState.taxGroup, taxType.key).map((opt) =>
    `<option value="${escapeHtml(opt)}" ${record.exemption === opt ? 'selected' : ''}>${opt || '—'}</option>`,
  ).join('');
  return `<select class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="exemption" aria-label="Причина звільнення: ${escapeHtml(taxType.label)}, ${escapeHtml(item.name)}">${options}</select>`;
}

function taxRow(item, taxType, index, record, deadline, isDefaultDeadline, fullyExempt) {
  const nameCell = index === 0 ? `<td rowspan="3" class="fop-name-cell${fullyExempt ? ' fop-fully-exempt' : ''}">${escapeHtml(shortClientName(item.name))}</td>` : '';
  const context = `${escapeHtml(taxType.label)}, ${escapeHtml(item.name)}`;
  return `<tr class="${record.exemption ? `exempt-row${fullyExempt ? ' fop-all-exempt' : ''}` : ''}" data-row-id="${escapeHtml(item.id)}">
    ${nameCell}
    <td>${taxType.label}</td>
    <td><input type="date" class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="queuedDate" value="${escapeHtml(record.queuedDate || '')}" aria-label="Набрано в банку: ${context}"></td>
    <td><input type="date" class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="paidDate" value="${escapeHtml(record.paidDate || '')}" aria-label="Дата сплати: ${context}"></td>
    <td class="tax-days">${record.exemption ? '-' : daysUntilLabel(deadline, record)}</td>
    <td><input type="date" class="tax-field ${isDefaultDeadline ? 'tax-field-default' : ''}" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="deadline" value="${escapeHtml(deadline)}" title="${isDefaultDeadline ? 'Значення з «Налаштувань». Змініть, щоб задати виняток лише для цього ФОП.' : ''}" aria-label="Дедлайн: ${context}"></td>
    <td class="tax-status">${statusPillHtml(record, deadline)}</td>
    <td>${exemptionSelect(item, taxType, record)}</td>
    <td><input type="text" class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="note" placeholder="Примітка" value="${escapeHtml(record.note || '')}" aria-label="Примітка: ${context}"></td>
  </tr>`;
}

export function renderTaxes() {
  if (!TAX_GROUPS.some((g) => g.key === uiState.taxGroup)) uiState.taxGroup = '12';
  const periods = taxPeriodsFor(uiState.taxGroup === '3' ? '3' : '1', getSettings().workingYear);
  if (!uiState.taxPeriod || !periods.some((p) => p.key === uiState.taxPeriod)) {
    const now = new Date(); const current = now.getFullYear() === getSettings().workingYear ? now.getMonth() : 0;
    uiState.taxPeriod = uiState.taxGroup === '3' ? periods[Math.max(0, Math.floor(current / 3) - 1)].key : periods[current].key;
  }

  const clients = getClientsByTaxTab(uiState.taxGroup, uiState.taxPeriod);
  const rows = [];
  clients.forEach((item) => {
    const realGroup = groupAtPeriod(item, uiState.taxPeriod);
    const records = TAX_TYPES.map((taxType) => getTaxField(item.id, realGroup, uiState.taxPeriod, taxType.key));
    const fullyExempt = records.every((record) => Boolean(record.exemption));
    TAX_TYPES.forEach((taxType, index) => {
      const record = records[index];
      const deadline = getEffectiveTaxDeadline(realGroup, taxType.key, uiState.taxPeriod, record);
      const isDefault = !record.deadline && Boolean(deadline);
      rows.push(taxRow(item, taxType, index, record, deadline, isDefault, fullyExempt));
    });
  });

  const groupTabs = TAX_GROUPS.map((g) =>
    `<button class="tab ${g.key === uiState.taxGroup ? 'active' : ''}" data-tax-group="${g.key}">${g.label}</button>`,
  ).join('');
  const periodTabs = periods.map((p) =>
    `<button class="tab ${p.key === uiState.taxPeriod ? 'active' : ''}" data-tax-period="${p.key}">${p.label}</button>`,
  ).join('');
  const hasPreviousPeriod = Boolean(previousPeriodKey(periods, uiState.taxPeriod));
  const copyPreviousButton = `<button type="button" class="auto-charge tax-copy-previous-period" data-copy-previous-period${hasPreviousPeriod && clients.length ? '' : ' disabled'} title="Перенести дані з попереднього періоду" aria-label="Перенести дані з попереднього періоду">✓</button>`;
  const reasonHeading = `<span class="tax-exemption-heading">${copyPreviousButton}<span>Причина звільнення</span></span>`;
  const body = clients.length
    ? table(rows, ['ПІБ', 'Податок', 'Набрано в банку', 'Дата сплати', 'Залишок', 'Дедлайн', 'Статус', reasonHeading, 'Примітка'], 'tax-table')
    : empty('У цій групі ще немає активних ФОП.');

  return `<div class="subnav section-control-row section-control-row-primary tax-main-nav"><div>${groupTabs}</div></div>
    <div class="subnav section-control-row section-control-row-secondary periods">${periodTabs}</div>
    ${body}`;
}
