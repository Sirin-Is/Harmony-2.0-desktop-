// render/taxes.js
// Builds the "Податки" tab: вкладки "1-2 група"/"3 група" (як у app.js —
// 1 і 2 групи мають однакові дедлайни й показані разом), період, і
// таблиця з трьома рядками на клієнта (Єдиний податок / Військовий збір / ЄСВ).

import { escapeHtml } from '../utils';
import { getTaxField, getClientsByTaxTab, getEffectiveTaxDeadline, getSettings } from '../state.js';
import { TAX_TYPES, TAX_GROUPS, taxPeriodsFor, exemptionOptions, statusPillHtml, daysUntilLabel, previousPeriodKey } from '../tax-model.ts';
import { shortClientName } from '../client-model.js';
import { table, empty } from './layout.js';
import { uiState } from '../ui-state.js';

function exemptionSelect(item, taxType, record) {
  const options = exemptionOptions(uiState.taxGroup).map((opt) =>
    `<option value="${escapeHtml(opt)}" ${record.exemption === opt ? 'selected' : ''}>${opt || '—'}</option>`,
  ).join('');
  return `<select class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="exemption">${options}</select>`;
}

function taxRow(item, taxType, index, record, deadline, isDefaultDeadline) {
  const nameCell = index === 0 ? `<td rowspan="3" class="fop-name-cell">${escapeHtml(shortClientName(item.name))}</td>` : '';
  return `<tr class="${record.exemption ? 'exempt-row' : ''}" data-row-id="${escapeHtml(item.id)}">
    ${nameCell}
    <td>${taxType.label}</td>
    <td><input type="date" class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="queuedDate" value="${escapeHtml(record.queuedDate || '')}"></td>
    <td><input type="date" class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="paidDate" value="${escapeHtml(record.paidDate || '')}"></td>
    <td class="tax-days">${daysUntilLabel(deadline, record)}</td>
    <td><input type="date" class="tax-field ${isDefaultDeadline ? 'tax-field-default' : ''}" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="deadline" value="${escapeHtml(deadline)}" title="${isDefaultDeadline ? 'Значення з «Налаштувань». Змініть, щоб задати виняток лише для цього ФОП.' : ''}"></td>
    <td class="tax-status">${statusPillHtml(record, deadline)}</td>
    <td>${exemptionSelect(item, taxType, record)}</td>
    <td><input type="text" class="tax-field" data-client="${escapeHtml(item.id)}" data-real-group="${escapeHtml(item.group)}" data-tax="${escapeHtml(taxType.key)}" data-field="note" placeholder="Примітка" value="${escapeHtml(record.note || '')}"></td>
  </tr>`;
}

export function renderTaxes() {
  if (!TAX_GROUPS.some((g) => g.key === uiState.taxGroup)) uiState.taxGroup = '12';
  const periods = taxPeriodsFor(uiState.taxGroup === '3' ? '3' : '1', getSettings().workingYear);
  if (!uiState.taxPeriod || !periods.some((p) => p.key === uiState.taxPeriod)) {
    const now = new Date(); const current = now.getFullYear() === getSettings().workingYear ? now.getMonth() : 0;
    uiState.taxPeriod = uiState.taxGroup === '3' ? periods[Math.floor(current / 3)].key : periods[current].key;
  }

  const clients = getClientsByTaxTab(uiState.taxGroup);
  const rows = [];
  clients.forEach((item) => {
    const realGroup = String(item.group);
    TAX_TYPES.forEach((taxType, index) => {
      const record = getTaxField(item.id, realGroup, uiState.taxPeriod, taxType.key);
      const deadline = getEffectiveTaxDeadline(realGroup, taxType.key, uiState.taxPeriod, record);
      const isDefault = !record.deadline && Boolean(deadline);
      rows.push(taxRow(item, taxType, index, record, deadline, isDefault));
    });
  });

  const groupTabs = TAX_GROUPS.map((g) =>
    `<button class="tab ${g.key === uiState.taxGroup ? 'active' : ''}" data-tax-group="${g.key}">${g.label}</button>`,
  ).join('');
  const periodTabs = periods.map((p) =>
    `<button class="tab ${p.key === uiState.taxPeriod ? 'active' : ''}" data-tax-period="${p.key}">${p.label}</button>`,
  ).join('');
  const body = clients.length
    ? table(rows, ['ПІБ', 'Податок', 'Набрано в банку', 'Дата сплати', 'Днів до дедлайну', 'Дедлайн', 'Статус', 'Причина звільнення', 'Примітка'], 'tax-table')
    : empty('У цій групі ще немає активних ФОП.');

  const hasPreviousPeriod = Boolean(previousPeriodKey(periods, uiState.taxPeriod));

  return `<div class="toolbar">
      <p class="note">Дедлайни підставляються автоматично з «Налаштувань» (пунктирна рамка). Змініть дедлайн вручну для конкретного ФОП, щоб задати виняток. Якщо у ФОП є причина звільнення, рядок стає сірим і статус не показується.</p>
      <div class="toolbar-actions">
        <button class="secondary" data-copy-previous-period${hasPreviousPeriod && clients.length ? '' : ' disabled'} title="Переносить дедлайн і причину звільнення з попереднього періоду, тільки в порожні поля. Дати сплати ніколи не копіюються.">Скопіювати з попереднього періоду</button>
      </div>
    </div>
    <div class="subnav">${groupTabs}</div>
    <div class="subnav periods">${periodTabs}</div>
    ${body}`;
}
