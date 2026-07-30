// render/reports.js
// Builds the "Звітність" tab: вкладки "1-2 група" (раз на рік) / "3 група"
// (щоквартально, ті самі періоди, що в Податках). Дедлайни підставляються
// з db.settings.reportDeadlines, як і в app.js.

import { escapeHtml } from '../utils';
import { getReportField, getClientsByTaxTab, getEffectiveReportDeadline, getSettings } from '../state.js';
import { REPORT_GROUPS, reportPeriodsFor, reportStatusPillHtml, reportDaysUntilLabel } from '../report-model.ts';
import { table, empty } from './layout.js';
import { uiState } from '../ui-state.js';

function reportRow(item, realGroup, record, deadline, isDefaultDeadline) {
  return `<tr data-row-id="${item.id}">
    <td class="fop-name-cell">${escapeHtml(item.name)}</td>
    <td><input type="date" class="report-field" data-client="${item.id}" data-real-group="${realGroup}" data-field="submittedDate" value="${escapeHtml(record.submittedDate || '')}"></td>
    <td class="report-days">${reportDaysUntilLabel(deadline, record)}</td>
    <td><input type="date" class="report-field ${isDefaultDeadline ? 'tax-field-default' : ''}" data-client="${item.id}" data-real-group="${realGroup}" data-field="deadline" value="${escapeHtml(deadline)}" title="${isDefaultDeadline ? 'Значення з «Налаштувань». Змініть, щоб задати виняток лише для цього ФОП.' : ''}"></td>
    <td class="report-status">${reportStatusPillHtml(record, deadline)}</td>
    <td><input type="text" class="report-field" data-client="${item.id}" data-real-group="${realGroup}" data-field="note" placeholder="Примітка" value="${escapeHtml(record.note || '')}"></td>
  </tr>`;
}

export function renderReports() {
  if (!REPORT_GROUPS.some((g) => g.key === uiState.reportGroup)) uiState.reportGroup = '12';
  const periods = reportPeriodsFor(uiState.reportGroup, getSettings().workingYear);
  if (!uiState.reportPeriod || !periods.some((p) => p.key === uiState.reportPeriod)) uiState.reportPeriod = periods[0].key;

  const clients = getClientsByTaxTab(uiState.reportGroup);
  const rows = clients.map((item) => {
    const realGroup = String(item.group);
    const record = getReportField(item.id, realGroup, uiState.reportPeriod);
    const deadline = getEffectiveReportDeadline(realGroup, uiState.reportPeriod, record);
    const isDefault = !record.deadline && Boolean(deadline);
    return reportRow(item, realGroup, record, deadline, isDefault);
  });

  const groupTabs = REPORT_GROUPS.map((g) =>
    `<button class="tab ${g.key === uiState.reportGroup ? 'active' : ''}" data-report-group="${g.key}">${g.label}</button>`,
  ).join('');
  const periodTabs = periods.map((p) =>
    `<button class="tab ${p.key === uiState.reportPeriod ? 'active' : ''}" data-report-period="${p.key}">${p.label}</button>`,
  ).join('');
  const body = clients.length
    ? table(rows, ['ПІБ', 'Дата подання', 'Днів до дедлайну', 'Дедлайн', 'Статус', 'Примітка'])
    : empty('У цій групі ще немає активних ФОП.');

  return `<div class="toolbar"><p class="note">1-2 групи подають звіт раз на рік; 3 група — щоквартально. Дедлайни підставляються з «Налаштувань», якщо не вказано власного значення.</p></div>
    <div class="subnav">${groupTabs}</div>
    <div class="subnav periods">${periodTabs}</div>
    ${body}`;
}
