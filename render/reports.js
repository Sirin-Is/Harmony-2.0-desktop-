// Декларації: усі релевантні періоди групи в одній таблиці.

import { escapeHtml } from '../utils';
import { getReportField, getSettings, getVisibleClients } from '../state.js';
import { REPORT_GROUPS, reportPeriodsFor } from '../report-model.ts';
import { empty } from './layout.js';
import { uiState } from '../ui-state.js';
import { shortClientName, groupAtPeriod } from '../client-model.js';

const STATUS = {
  notReportable: { label: 'Не звітний' },
  notSubmitted: { label: 'Не подано' },
  submitted: { label: 'Подано' },
  accepted: { label: 'Прийнято' },
};

function statusFor(record) {
  if (STATUS[record.filingStatus]) return record.filingStatus;
  if (record.notReportable) return 'notReportable';
  return record.submittedDate ? 'submitted' : 'notSubmitted';
}

function periodCells(client, period) {
  const realGroup = groupAtPeriod(client, period.key);
  const record = getReportField(client.id, realGroup, period.key);
  const status = statusFor(record);
  const name = escapeHtml(client.name);
  return `<td class="report-filing-status-cell"><button type="button" class="report-filing-status report-filing-status-${status}" data-report-status data-client="${escapeHtml(client.id)}" data-real-group="${escapeHtml(realGroup)}" data-period="${escapeHtml(period.key)}" data-status="${status}" aria-label="${STATUS[status].label}: ${name}" title="Натисніть, щоб змінити статус">${STATUS[status].label}</button></td><td><input type="text" class="report-field" data-client="${escapeHtml(client.id)}" data-real-group="${escapeHtml(realGroup)}" data-period="${escapeHtml(period.key)}" data-field="note" placeholder="Примітка" value="${escapeHtml(record.note || '')}" aria-label="Примітка, ${period.label}: ${name}"></td>`;
}

function declarationsTable(rows, periods) {
  const headings = periods.map((period) => `<th colspan="2" class="report-period-heading">${escapeHtml(period.label)}</th>`).join('');
  const columns = periods.map(() => '<col class="declaration-status-column"><col class="declaration-note-column">').join('');
  const widthClass = periods.length === 1 ? ' declarations-table-single-period' : '';
  return `<div class="table-wrap"><table class="table declarations-table${widthClass}"><colgroup><col class="declaration-fop-column">${columns}</colgroup><thead><tr><th class="fop-name-cell">ПІБ</th>${headings}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

export function renderReports() {
  if (!REPORT_GROUPS.some((group) => group.key === uiState.reportGroup)) uiState.reportGroup = '12';
  const periods = reportPeriodsFor(uiState.reportGroup, getSettings().workingYear);
  const clients = getVisibleClients().filter((client) => periods.some((period) => uiState.reportGroup === '3' ? groupAtPeriod(client, period.key) === '3' : ['1', '2'].includes(groupAtPeriod(client, period.key))));
  const groupTabs = REPORT_GROUPS.map((group) => `<button class="tab ${group.key === uiState.reportGroup ? 'active' : ''}" data-report-group="${group.key}">${group.label}</button>`).join('');
  const rows = clients.map((client) => `<tr data-row-id="${escapeHtml(client.id)}"><td class="fop-name-cell">${escapeHtml(shortClientName(client.name))}</td>${periods.map((period) => periodCells(client, period)).join('')}</tr>`);
  return `<div class="subnav section-control-row section-control-row-primary report-main-nav"><div>${groupTabs}</div></div>${clients.length ? declarationsTable(rows, periods) : empty('У цій групі ще немає активних ФОП.')}`;
}
