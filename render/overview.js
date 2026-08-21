// render/overview.js
// Зведення зауважень по розділах: Загальні дані (КЕП), Доходи (ліміт),
// Податки/Звітність (дедлайни ≤5 днів), Оплати (борг ≤5 днів до кінця
// місяця). Клік на ПІБ переносить у відповідний розділ і підсвічує рядок.

import { escapeHtml, monthPeriodKey, daysUntil } from '../utils';
import { getVisibleClients, getTaxField, getEffectiveTaxDeadline, getReportField, getEffectiveReportDeadline, getCombinedReportField, getEffectiveCombinedReportDeadline, getMonthlyCellValue, getIncomeValue, getHrMonthlyDocuments, getSettings } from '../state.js';
import { TAX_TYPES, taxPeriodsFor } from '../tax-model';
import { reportPeriodsFor, combinedReportPeriodsFor } from '../report-model';
import { groupLimitAmount, GROUP_MZP_MULTIPLIERS, shortClientName } from '../client-model';
import { isIncomeLimitWarning } from '../income-model.js';
import { payrollDatesForPeriod } from '../payroll-model.js';

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
      if (record.notReportable || ['submitted', 'accepted'].includes(record.filingStatus) || record.submittedDate) return;
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

function combinedReportAlertEntries() {
  const year = getSettings().workingYear;
  const entries = [];
  getVisibleClients().forEach((item) => {
    let worst = null;
    combinedReportPeriodsFor(year).forEach((period) => {
      const record = getCombinedReportField(item.id, period.key);
      if (record.notReportable || record.combinedStatus === 'notReportable' || ['submitted', 'accepted'].includes(record.combinedStatus) || record.submittedDate) return;
      const deadline = getEffectiveCombinedReportDeadline(period.key, record);
      const days = daysUntil(deadline);
      if (days === null || days > 5) return;
      if (!worst || days < worst.days) worst = { period: period.key, days };
    });
    if (worst) entries.push({ id: item.id, name: shortClientName(item.name), period: worst.period });
  });
  return entries;
}

function serviceDebtAlertEntries() {
  const workingYear = getSettings().workingYear;
  const entries = [];
  getVisibleClients().forEach((item) => {
    for (let m = 0; m < 12; m++) {
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

function alertNamesHtml(entries, section, emptyText, prefix) {
  if (!entries.length) return `<span class="muted">${emptyText}</span>`;
  const shown = entries.slice(0, 5).map((e) =>
    `<button type="button" class="overview-link" data-alert-section="${escapeHtml(section)}" data-alert-client="${escapeHtml(e.id)}" data-alert-group="${escapeHtml(e.group || '')}" data-alert-period="${escapeHtml(e.period || '')}">${escapeHtml(e.name)}</button>`,
  ).join(', ');
  const more = entries.length > 5 ? `, та інші (${entries.length - 5})` : '';
  return `${prefix}${shown}${more}`;
}

function overviewRow(title, entries, section, emptyText, prefix) {
  return `<div class="overview-row">
    <div class="overview-row-head"><span class="overview-status ${entries.length ? 'warn' : 'ok'}" aria-label="${entries.length ? 'Є зауваження' : 'Все виконано'}">${entries.length ? '!' : '✓'}</span><h2>${title}</h2></div>
    <div class="overview-row-body">${alertNamesHtml(entries, section, emptyText, prefix)}</div>
  </div>`;
}

function reminderRow(title, message) {
  return `<div class="overview-row"><div class="overview-row-head"><span class="overview-status warn" aria-label="Є зауваження">!</span><h2>${title}</h2></div><div class="overview-row-body">${message}</div></div>`;
}

function birthdayRow() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const matches = getVisibleClients().map((item) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.birthDate || '')) return null;
    const month = Number(item.birthDate.slice(5, 7)) - 1; const day = Number(item.birthDate.slice(8, 10));
    let next = new Date(today.getFullYear(), month, day);
    if (next < today) next = new Date(today.getFullYear() + 1, month, day);
    return { id: item.id, name: item.name, days: Math.round((next - today) / 86400000) };
  }).filter((item) => item && item.days <= 5);
  const todays = matches.filter((item) => item.days === 0);
  const entries = todays.length ? todays : matches;
  const names = entries.map((item) => `<button type="button" class="overview-link" data-alert-section="dashboard" data-alert-client="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>`).join(', ');
  const plural = entries.length > 1 ? 'дні народження' : 'день народження';
  const text = !entries.length ? 'Найближчим часом іменинників немає' : todays.length ? `Сьогодні у ${names} ${plural}, не забудь привітати` : `Скоро у ${names} ${plural}, не забудь привітати`;
  return `<div class="overview-row"><div class="overview-row-head"><span class="overview-status ${entries.length ? 'warn' : 'ok'}">${entries.length ? '!' : '✓'}</span><h2>Дні народження</h2></div><div class="overview-row-body">${text}</div></div>`;
}

function hrDocumentsAlertEntries() {
  const period = monthPeriodKey(getSettings().workingYear, new Date().getMonth() + 1);
  const records = new Map(getHrMonthlyDocuments().filter((item) => item.period === period).map((item) => [item.clientId, item]));
  return getVisibleClients().filter((client) => (client.employees || []).length).filter((client) => {
    const record = records.get(client.id);
    return !record || record.timesheetStatus !== 'Надіслано' || record.payrollStatus !== 'Надіслано' || record.cashStatementStatus !== 'Надіслано';
  }).map((client) => ({ id: client.id, name: shortClientName(client.name) }));
}

function todayIso() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function salaryReminder() {
  const today = todayIso(); const year = getSettings().workingYear;
  if (!today.startsWith(`${year}-`)) return false;
  return Array.from({ length: 12 }, (_, i) => payrollDatesForPeriod(getSettings(), `${year}-${String(i + 1).padStart(2, '0')}`)).some((dates) => dates.secondHalf === today || dates.firstHalf === today);
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
  const combinedReportAlerts = combinedReportAlertEntries();
  const serviceAlerts = serviceDebtAlertEntries();
  const hrAlerts = hrDocumentsAlertEntries();
  return `${salaryReminder() ? reminderRow('Виплата ЗП', 'Сьогодні день виплати зарплати') : ''}
    ${overviewRow('Термін дії КЕП', kepAlerts, 'dashboard', 'Найближчим часом не спливає термін дії жодного КЕП', 'Спливає термін дії КЕП: ')}
    ${overviewRow('Сплата послуг', serviceAlerts, 'payments', 'Всі сплатили наші послуги', 'Наші послуги мають ще сплатити: ')}
    ${overviewRow('Сплата податків', taxAlerts, 'taxes', 'Всі податки сплачені', 'Повинні сплатити податки: ')}
    ${overviewRow('Контроль лімітів', incomeAlerts, 'incomes', 'Жоден ФОП не наблизився до вичерпання ліміту', 'До вичерпання ліміту наближаються: ')}
    ${overviewRow('Декларації по доходам', reportAlerts, 'reports', 'Всі декларації подано', 'Треба подати декларації по ')}
    ${overviewRow('Об’єднані звіти', combinedReportAlerts, 'combinedReports', 'Всі об’єднані звіти подано', 'Треба подати об’єднані звіти по ')}
    ${overviewRow('Кадрові документи', hrAlerts, 'hr', 'Всі кадрові документи цього місяця надіслані', 'Треба надіслати кадрові документи ')}
    ${birthdayRow()}`;
}
