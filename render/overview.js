// render/overview.js
// Зведення зауважень по розділах: Загальні дані (КЕП), Доходи (ліміт),
// Податки/Звітність (дедлайни ≤5 днів), Оплати (борг ≤5 днів до кінця
// місяця). Клік на ПІБ переносить у відповідний розділ і підсвічує рядок.

import { escapeHtml, monthPeriodKey, daysUntil } from '../utils';
import { getVisibleClients, getTaxField, getEffectiveTaxDeadline, getReportField, getEffectiveReportDeadline, getMonthlyCellValue, getIncomeValue, getHrMonthlyDocuments, getSettings } from '../state.js';
import { TAX_TYPES, taxPeriodsFor } from '../tax-model';
import { reportPeriodsFor } from '../report-model';
import { groupLimitAmount, GROUP_MZP_MULTIPLIERS, shortClientName } from '../client-model';
import { isIncomeLimitWarning } from '../income-model.js';

function kepAlertEntries() {
  return getVisibleClients().filter((item) => {
    const d = daysUntil(item.kepExpiry);
    return d !== null && d < 3;
  }).map((item) => ({ id: item.id, name: shortClientName(item.name) }));
}

function taxAlertEntries() {
  const workingYear = getSettings().workingYear;
  const entries = [];
  getVisibleClients().filter((item) => ['1', '2', '3'].includes(String(item.group))).forEach((item) => {
    const realGroup = String(item.group);
    let worst = null;
    taxPeriodsFor(realGroup, workingYear).forEach((period) => {
      TAX_TYPES.forEach((taxType) => {
        const record = getTaxField(item.id, realGroup, period.key, taxType.key);
        if (record.exemption || record.paidDate) return;
        const deadline = getEffectiveTaxDeadline(realGroup, taxType.key, period.key, record);
        if (!deadline) return;
        const days = daysUntil(deadline);
        if (days === null || days > 5) return;
        if (!worst || days < worst.days) worst = { period: period.key, days };
      });
    });
    if (worst) entries.push({ id: item.id, name: shortClientName(item.name), group: realGroup === '3' ? '3' : '12', period: worst.period });
  });
  return entries;
}

function reportAlertEntries() {
  const workingYear = getSettings().workingYear;
  const entries = [];
  getVisibleClients().filter((item) => ['1', '2', '3'].includes(String(item.group))).forEach((item) => {
    const realGroup = String(item.group);
    let worst = null;
    reportPeriodsFor(realGroup, workingYear).forEach((period) => {
      const record = getReportField(item.id, realGroup, period.key);
      if (record.submittedDate) return;
      const deadline = getEffectiveReportDeadline(realGroup, period.key, record);
      if (!deadline) return;
      const days = daysUntil(deadline);
      if (days === null || days > 5) return;
      if (!worst || days < worst.days) worst = { period: period.key, days };
    });
    if (worst) entries.push({ id: item.id, name: shortClientName(item.name), group: realGroup === '3' ? '3' : '12', period: worst.period });
  });
  return entries;
}

function serviceDebtAlertEntries() {
  const workingYear = getSettings().workingYear;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const entries = [];
  getVisibleClients().forEach((item) => {
    for (let m = 0; m < 12; m++) {
      const monthEnd = new Date(workingYear, m + 1, 0);
      const daysToEnd = Math.round((monthEnd - today) / 86400000);
      if (daysToEnd > 5) break; // months are chronological — later months are even further away
      const key = monthPeriodKey(workingYear, m + 1);
      const charged = Number(getMonthlyCellValue(item.id, key, 'charged')) || 0;
      const paid = Number(getMonthlyCellValue(item.id, key, 'paid')) || 0;
      if (charged - paid > 0) { entries.push({ id: item.id, name: shortClientName(item.name) }); return; }
    }
  });
  return entries;
}

function currentMonthsElapsed(workingYear) {
  const now = new Date();
  if (now.getFullYear() < workingYear) return 1;
  if (now.getFullYear() > workingYear) return 12;
  return now.getMonth() + 1;
}

function incomeAlertEntries() {
  const workingYear = getSettings().workingYear;
  const monthsElapsed = currentMonthsElapsed(workingYear);
  const monthIndexes = Array.from({ length: monthsElapsed }, (_, i) => i);
  const entries = [];
  getVisibleClients().filter((item) => GROUP_MZP_MULTIPLIERS[item.group]).forEach((item) => {
    const monthlyValues = monthIndexes.map((index) => getIncomeValue(item.id, monthPeriodKey(workingYear, index + 1)));
    const limit = groupLimitAmount(item.group, getSettings().minWage);
    if (isIncomeLimitWarning(limit, monthlyValues)) entries.push({ id: item.id, name: shortClientName(item.name), group: String(item.group) === '3' ? '3' : '12' });
  });
  return entries;
}

function alertNamesHtml(entries, section) {
  if (!entries.length) return '<span class="muted">Немає зауважень.</span>';
  const shown = entries.slice(0, 5).map((e) =>
    `<button type="button" class="overview-link" data-alert-section="${section}" data-alert-client="${e.id}" data-alert-group="${escapeHtml(e.group || '')}" data-alert-period="${escapeHtml(e.period || '')}">${escapeHtml(e.name)}</button>`,
  ).join(', ');
  const more = entries.length > 5 ? `, та інші (${entries.length - 5})` : '';
  return shown + more;
}

function overviewRow(title, entries, section, note) {
  return `<div class="overview-row">
    <div class="overview-row-head"><h2>${title}</h2><span class="pill ${entries.length ? 'late' : 'ok'}">${entries.length ? entries.length : 'OK'}</span></div>
    <div class="overview-row-body">${alertNamesHtml(entries, section)}${note ? `<span class="overview-row-note">${note}</span>` : ''}</div>
  </div>`;
}

function reminderRow(title, message) {
  return `<div class="overview-row"><div class="overview-row-head"><h2>${title}</h2><span class="pill warn">!</span></div><div class="overview-row-body">${message}</div></div>`;
}

function todayIso() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function salaryReminder() {
  const today = todayIso(); const year = getSettings().workingYear;
  if (!today.startsWith(`${year}-`)) return false;
  return Array.from({ length: 12 }, (_, i) => i + 1).some((month) => [7, 21].some((day) => { const date = new Date(year, month - 1, day); if (date.getDay() === 6) date.setDate(date.getDate() - 1); if (date.getDay() === 0) date.setDate(date.getDate() - 2); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === today; }));
}
function hrDocumentsReminder() {
  const now = new Date(); const year = getSettings().workingYear; if (now.getFullYear() !== year) return '';
  const period = monthPeriodKey(year, now.getMonth() + 1);
  const records = new Map(getHrMonthlyDocuments().filter((item) => item.period === period).map((item) => [item.clientId, item]));
  const pending = getVisibleClients().filter((client) => (client.employees || []).length).some((client) => { const record = records.get(client.id); return !record || record.timesheetStatus !== 'Надіслано' || record.payrollStatus !== 'Надіслано' || record.cashStatementStatus !== 'Надіслано'; });
  return pending ? new Intl.DateTimeFormat('uk-UA', { month: 'long' }).format(now).toLowerCase() : '';
}

export function renderOverview() {
  const kepAlerts = kepAlertEntries();
  const incomeAlerts = incomeAlertEntries();
  const taxAlerts = taxAlertEntries();
  const reportAlerts = reportAlertEntries();
  const serviceAlerts = serviceDebtAlertEntries();
  const hrMonth = hrDocumentsReminder();
  return `<div class="toolbar"><p class="note">Зведення зауважень по всіх розділах. Натисніть на ПІБ, щоб перейти до відповідного розділу й періоду.</p></div>
    ${salaryReminder() ? reminderRow('Виплата ЗП', 'Сьогодні день виплати зарплати') : ''}
    ${hrMonth ? reminderRow('Кадрові документи', `Відправ клієнтам кадрові документи за ${hrMonth}`) : ''}
    ${overviewRow('Термін дії КЕП', kepAlerts, 'dashboard', 'КЕП спливає менш ніж за 3 дні')}
    ${overviewRow('Доходи', incomeAlerts, 'incomes', 'Залишок ліміту менший за 3 середньомісячних доходи')}
    ${overviewRow('Податки', taxAlerts, 'taxes', 'До дедлайну ≤ 5 днів, а сплати ще не було')}
    ${overviewRow('Звітність', reportAlerts, 'reports', 'До дедлайну ≤ 5 днів, а звіт ще не подано')}
    ${overviewRow('Оплати', serviceAlerts, 'payments', 'До кінця місяця ≤ 5 днів, а оплата послуг не закрита')}`;
}
