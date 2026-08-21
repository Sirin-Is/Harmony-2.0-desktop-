import { escapeHtml } from '../utils';
import { getCombinedReportField, getSettings, getVisibleClients } from '../state.js';
import { combinedReportPeriodsFor } from '../report-model.ts';
import { shortClientName } from '../client-model.js';
import { empty, table } from './layout.js';
import { uiState } from '../ui-state.js';

const STATUS = {
  notReportable: { label: 'Не звітний', next: 'notSubmitted' },
  notSubmitted: { label: 'Не подано', next: 'submitted' },
  submitted: { label: 'Подано', next: 'accepted' },
  accepted: { label: 'Прийнято', next: 'notReportable' },
};

function statusFor(record) {
  if (STATUS[record.combinedStatus]) return record.combinedStatus;
  if (record.notReportable) return 'notReportable';
  return record.submittedDate ? 'submitted' : 'notSubmitted';
}

function quarterCells(client, period) {
  const record = getCombinedReportField(client.id, period.key);
  const status = statusFor(record);
  const name = escapeHtml(client.name);
  return `<td class="combined-report-status-cell"><button type="button" class="combined-report-status combined-report-status-${status}" data-combined-report-status data-client="${escapeHtml(client.id)}" data-period="${escapeHtml(period.key)}" data-status="${status}" aria-label="${STATUS[status].label}: ${name}" title="Натисніть, щоб змінити статус">${STATUS[status].label}</button></td><td><input type="text" class="combined-report-field" data-client="${escapeHtml(client.id)}" data-period="${escapeHtml(period.key)}" data-field="note" placeholder="Примітка" value="${escapeHtml(record.note || '')}" aria-label="Примітка, ${period.label}: ${name}"></td>`;
}

export function renderCombinedReports() {
  const year = getSettings().workingYear;
  const periods = combinedReportPeriodsFor(year);
  const clients = getVisibleClients();
  const rows = clients.map((client) => `<tr data-row-id="${escapeHtml(client.id)}"><td class="fop-name-cell">${escapeHtml(shortClientName(client.name))}</td>${periods.map((period) => quarterCells(client, period)).join('')}</tr>`);
  const headings = ['ПІБ', ...periods.flatMap((period) => [`${period.label} — статус`, `${period.label} — примітка`])];
  return clients.length ? table(rows, headings, 'combined-reports-table') : empty('Активних ФОП поки немає.');
}
