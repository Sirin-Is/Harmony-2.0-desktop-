import { escapeHtml } from '../utils';
import { getCombinedReportField, getEffectiveCombinedReportDeadline, getSettings, getVisibleClients } from '../state.js';
import { combinedReportPeriodsFor, reportDaysUntilLabel, reportStatusPillHtml } from '../report-model.ts';
import { shortClientName } from '../client-model.js';
import { empty, table } from './layout.js';
import { uiState } from '../ui-state.js';

function row(client, record, deadline, isDefaultDeadline) {
  const name = escapeHtml(client.name);
  const notReportable = Boolean(record.notReportable);
  return `<tr data-row-id="${escapeHtml(client.id)}">
    <td class="fop-name-cell">${escapeHtml(shortClientName(client.name))}</td>
    <td class="combined-report-toggle"><input type="checkbox" class="combined-report-field" data-client="${escapeHtml(client.id)}" data-field="notReportable" ${notReportable ? 'checked' : ''} aria-label="Не звітний період: ${name}"></td>
    <td><input type="date" class="combined-report-field" data-client="${escapeHtml(client.id)}" data-field="submittedDate" value="${escapeHtml(record.submittedDate || '')}" ${notReportable ? 'disabled' : ''} aria-label="Дата подання об’єднаного звіту: ${name}"></td>
    <td class="report-days">${notReportable ? '-' : reportDaysUntilLabel(deadline, record)}</td>
    <td><input type="date" class="combined-report-field ${isDefaultDeadline ? 'tax-field-default' : ''}" data-client="${escapeHtml(client.id)}" data-field="deadline" value="${escapeHtml(deadline)}" ${notReportable ? 'disabled' : ''} title="${isDefaultDeadline ? 'Значення з «Налаштувань». Змініть, щоб задати виняток лише для цього ФОП.' : ''}" aria-label="Дедлайн об’єднаного звіту: ${name}"></td>
    <td class="report-status">${notReportable ? '-' : reportStatusPillHtml(record, deadline)}</td>
    <td><input type="text" class="combined-report-field" data-client="${escapeHtml(client.id)}" data-field="note" placeholder="Примітка" value="${escapeHtml(record.note || '')}" ${notReportable ? 'disabled' : ''} aria-label="Примітка до об’єднаного звіту: ${name}"></td>
  </tr>`;
}

export function renderCombinedReports() {
  const year = getSettings().workingYear;
  const periods = combinedReportPeriodsFor(year);
  if (!uiState.combinedReportPeriod || !periods.some((period) => period.key === uiState.combinedReportPeriod)) {
    const month = new Date().getFullYear() === year ? new Date().getMonth() : 0;
    uiState.combinedReportPeriod = periods[Math.max(0, Math.floor(month / 3) - 1)].key;
  }
  const clients = getVisibleClients();
  const rows = clients.map((client) => {
    const record = getCombinedReportField(client.id, uiState.combinedReportPeriod);
    const deadline = getEffectiveCombinedReportDeadline(uiState.combinedReportPeriod, record);
    return row(client, record, deadline, !record.deadline && Boolean(deadline));
  });
  const tabs = periods.map((period) => `<button class="tab ${period.key === uiState.combinedReportPeriod ? 'active' : ''}" data-combined-report-period="${period.key}">${period.label}</button>`).join('');
  const body = clients.length ? table(rows, ['ПІБ', 'Не звітний', 'Дата подання', 'Днів до дедлайну', 'Дедлайн', 'Статус', 'Примітка']) : empty('Активних ФОП поки немає.');
  return `<div class="subnav periods">${tabs}</div>${body}`;
}
