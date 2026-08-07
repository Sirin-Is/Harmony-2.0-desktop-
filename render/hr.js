import { escapeHtml } from '../utils.js';
import { getHrOrders, getVisibleClients, getPayrollRecords } from '../state.js';
import { getHrMonthlyDocuments, getSettings } from '../state.js';
import { uiState } from '../ui-state.js';
import { MONTH_NAMES_UA, monthPeriodKey } from '../utils.js';
import { empty, table } from './layout.js';

const esc = escapeHtml;
const shortName = (name = '') => name.trim().split(/\s+/).slice(0, 2).join(' ') || '-';
const date = (value) => value ? new Intl.DateTimeFormat('uk-UA').format(new Date(`${value}T00:00:00`)) : '-';
const MONTH_NAMES_GENITIVE_UA = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

function employees() {
  const rows = getVisibleClients().flatMap((client) => {
    const list = Array.isArray(client.employees) ? client.employees : [];
    return list.map((employee, index) => `<tr>${index === 0 ? `<td rowspan="${list.length}">${esc(shortName(client.name))}</td>` : ''}<td><strong>${esc(employee.name || '-')}</strong></td><td>${esc(employee.position || '-')}</td><td>-</td></tr>`);
  });
  return table(rows, ['ФОП', 'Працівник', 'Посада', 'Примітка'], 'hr-table');
}

function orders(period) {
  const clients = new Map(getVisibleClients().map((client) => [client.id, client]));
  const rows = [...getHrOrders()].filter((order) => !period || !order.period || order.period === period).sort((a, b) => String(b.date).localeCompare(String(a.date))).map((order) => { const sent = order.deliveryStatus === 'Надіслано'; return `<tr><td><strong>${esc(shortName(clients.get(order.clientId)?.name || '-'))}</strong></td><td>${esc(order.number)}</td><td>${date(order.date)}</td><td>${esc(order.subject)}</td><td>${esc(order.employeeName || '-')}</td><td>${date(order.effectiveDate)}</td><td><button class="delivery-status ${sent ? 'sent' : 'pending'}" data-toggle-order-delivery="${esc(order.id)}" title="Змінити статус">${sent ? 'Надіслано' : 'Не надіслано'}</button></td><td><button class="icon" data-delete-hr-order="${esc(order.id)}" title="Видалити документ">✕</button></td></tr>`; });
  return `<div class="toolbar"><p class="note">Фіксуйте кадрові документи, які необхідно надіслати конкретному ФОП.</p><button class="primary" data-add-hr-order>+ Документ</button></div>${rows.length ? table(rows, ['ФОП', '№', 'Дата', 'Суть документа', 'Працівник', 'Початок дії', 'Статус', ''], 'hr-table') : empty('Кадрових документів поки немає.')}`;
}

function statusButton(clientId, period, field, value) {
  const sent = value === 'Надіслано';
  return `<button class="delivery-status ${sent ? 'sent' : 'pending'}" data-hr-document="${esc(clientId)}" data-hr-period="${period}" data-hr-field="${field}" title="Змінити статус">${sent ? 'Надіслано' : 'Не надіслано'}</button>`;
}

function documents() {
  const clients = getVisibleClients().filter((client) => client.hadEmployees || (client.employees || []).length || Number(client.employeesCount) > 0);
  const settings = getSettings();
  if (!uiState.hrDocumentsMonth) uiState.hrDocumentsMonth = new Date().getFullYear() === settings.workingYear ? new Date().getMonth() + 1 : 1;
  const month = uiState.hrDocumentsMonth;
  const period = monthPeriodKey(settings.workingYear, month);
  const records = new Map(getHrMonthlyDocuments().filter((record) => record.period === period).map((record) => [record.clientId, record]));
  const rows = clients.map((client) => {
    const record = records.get(client.id) || {};
    return `<tr><td><strong>${esc(shortName(client.name))}</strong></td><td>${statusButton(client.id, period, 'timesheetStatus', record.timesheetStatus)}</td><td>${statusButton(client.id, period, 'payrollStatus', record.payrollStatus)}</td><td>${statusButton(client.id, period, 'cashStatementStatus', record.cashStatementStatus)}</td></tr>`;
  });
  return `<div class="toolbar"><div class="toolbar-actions"><button class="secondary" data-hr-doc-prev ${month === 1 ? 'disabled' : ''}>←</button><strong class="calendar-period">${MONTH_NAMES_UA[month - 1]} ${settings.workingYear}</strong><button class="secondary" data-hr-doc-next ${month === 12 ? 'disabled' : ''}>→</button></div></div>
    <p class="note">Натисніть статус, щоб позначити документ як надісланий або не надісланий.</p>
    ${rows.length ? table(rows, ['ФОП', 'Табель робочого часу', 'Розрахунково-платіжна відомість', 'Відомість на виплату готівки'], 'hr-documents-table') : empty('ФОП із найманими працівниками поки немає.')}
    <section class="hr-orders-section"><h3>Накази</h3>${orders(period)}</section>`;
}

const money = (value) => Number(String(value || '').replace(/\s+/g, '').replace(',', '.')) || 0;
const payrollDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(2, 4)}` : '';
const input = (record, field) => field === 'paymentDate'
  ? `<div class="payroll-date-control"><input class="payroll-field payroll-date-field" type="text" inputmode="numeric" maxlength="8" data-payroll-id="${esc(record.id)}" data-payroll-field="${esc(field)}" value="${esc(payrollDate(record[field]))}" placeholder="дд.мм.рр"><button type="button" class="payroll-date-picker" data-payroll-picker="${esc(record.id)}" title="Відкрити календар" aria-label="Відкрити календар">🗓</button><input class="payroll-native-date" type="date" tabindex="-1" data-payroll-id="${esc(record.id)}" data-payroll-native-date="${esc(record.id)}" value="${esc(record[field] || '')}"></div>`
  : `<input class="payroll-field" inputmode="decimal" data-payroll-id="${esc(record.id)}" data-payroll-field="${esc(field)}" value="${esc(record[field] || '')}" placeholder="-">`;
function salary() {
  const settings = getSettings();
  if (!uiState.payrollMonth) uiState.payrollMonth = new Date().getFullYear() === settings.workingYear ? new Date().getMonth() + 1 : 1;
  const month = uiState.payrollMonth;
  const period = monthPeriodKey(settings.workingYear, month);
  const clients = getVisibleClients().filter((client) => (client.employees || []).length);
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const paymentType = (type) => type || `Виплата за другу половину ${MONTH_NAMES_GENITIVE_UA[month === 1 ? 11 : month - 2]}`;
  const chronology = (a, b) => String(a.paymentDate || '9999-12-31').localeCompare(String(b.paymentDate || '9999-12-31')) || String(a.id).localeCompare(String(b.id));
  const typeRank = (type) => (/другу половину/.test(type) ? 1 : /першу половину/.test(type) ? 2 : type === 'Звільнення' ? 3 : type === 'Відпустка' ? 4 : type === 'Лікарняні' ? 5 : 99);
  const groupChronology = ([typeA, recordsA], [typeB, recordsB]) => {
    const dateA = recordsA[0]?.paymentDate || ''; const dateB = recordsB[0]?.paymentDate || '';
    if (dateA && dateB) return dateA.localeCompare(dateB) || typeRank(typeA) - typeRank(typeB);
    if (dateA) return -1;
    if (dateB) return 1;
    return typeRank(typeA) - typeRank(typeB) || typeA.localeCompare(typeB);
  };
  const clientChronology = (recordsA, recordsB) => {
    const dateA = recordsA[0]?.paymentDate || ''; const dateB = recordsB[0]?.paymentDate || '';
    if (dateA && dateB) return dateA.localeCompare(dateB) || String(names.get(recordsA[0].clientId)).localeCompare(String(names.get(recordsB[0].clientId)));
    if (dateA) return -1;
    if (dateB) return 1;
    return String(names.get(recordsA[0].clientId)).localeCompare(String(names.get(recordsB[0].clientId)));
  };
  const byPaymentBatch = new Map();
  getPayrollRecords().filter((record) => record.period === period).sort(chronology).forEach((record) => {
    const type = paymentType(record.paymentType); const key = `${record.paymentDate || ''}|${type}`;
    const batch = byPaymentBatch.get(key) || { type, records: [] }; batch.records.push(record); byPaymentBatch.set(key, batch);
  });
  const rows = [...byPaymentBatch.values()].sort((a, b) => groupChronology([a.type, a.records], [b.type, b.records])).flatMap(({ type, records: batchRecords }) => {
    const byClient = new Map(); batchRecords.forEach((record) => { const list = byClient.get(record.clientId) || []; list.push(record); byClient.set(record.clientId, list); });
    const total = (field) => batchRecords.reduce((sum, record) => sum + money(record[field]), 0);
    const totalGross = batchRecords.reduce((sum, record) => sum + money(record.amount) / 0.77, 0);
    const formatTotal = (value) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value).replace(/\u00a0/g, ' ');
    const headerRow = `<tr class="payroll-type-row"><td colspan="2"></td><td>${esc(type)}</td><td class="payroll-batch-total">${formatTotal(total('amount'))}</td><td class="payroll-batch-total">${formatTotal(total('pdfo'))}</td><td class="payroll-batch-total">${formatTotal(total('vz'))}</td><td class="payroll-batch-total">${formatTotal(total('esv'))}</td><td></td><td class="payroll-batch-total">${formatTotal(totalGross)}</td><td></td><td></td><td></td></tr>`;
    return [headerRow, ...[...byClient.values()].sort(clientChronology).flatMap((records) => records.sort(chronology).map((record, index) => {
    const clientId = record.clientId;
    const gross = money(record.amount) / 0.77;
    const check = (rate, value) => gross * rate - money(value);
    const result = (rate, value) => gross ? `<span class="payroll-check ${Math.abs(check(rate, value)) < 1 ? 'ok' : 'warn'}">${check(rate, value).toFixed(2)}</span>` : '-';
    return `<tr>${index === 0 ? `<td rowspan="${records.length}" class="payroll-date">${input(record, 'paymentDate')}</td><td rowspan="${records.length}" class="payroll-client"><strong>${esc(shortName(names.get(clientId) || '-'))}</strong></td>` : ''}<td><button class="icon payroll-delete" data-delete-payroll="${esc(record.id)}" title="Видалити рядок">✕</button>${esc(record.employeeName)}</td><td>${input(record, 'amount')}</td><td>${input(record, 'pdfo')}</td><td>${input(record, 'vz')}</td><td>${input(record, 'esv')}</td><td><select class="payroll-field" data-payroll-id="${esc(record.id)}" data-payroll-field="status">${['Набрано','Сплачено','Повідомлено','Сплачено невчасно'].map((s) => `<option ${record.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td>${gross ? gross.toFixed(2) : '-'}</td><td>${result(.18, record.pdfo)}</td><td>${result(.05, record.vz)}</td><td>${result(.22, record.esv)}</td></tr>`;
    }))];
  });
  return `<div class="toolbar"><div class="toolbar-actions"><button class="secondary" data-payroll-prev ${month === 1 ? 'disabled' : ''}>←</button><strong class="calendar-period">${MONTH_NAMES_UA[month - 1]} ${settings.workingYear}</strong><button class="secondary" data-payroll-next ${month === 12 ? 'disabled' : ''}>→</button><button class="primary" data-add-payroll-client>+ Додати ФОП</button><button class="secondary" data-add-payroll-employee>+ Працівник</button></div></div><p class="note">Сума виплати вказується «на руки». Контрольні значення рахуються за ставками ПДФО 18%, ВЗ 5% та ЄСВ 22%.</p>${rows.length ? table(rows, ['Дата','ПІБ ФОП','ПІБ працівника','Сума виплати','ПДФО','ВЗ','ЄСВ','Статус','До оподатк.','Перев. ПДФО','Перев. ВЗ','Перев. ЄСВ'], 'payroll-table') : empty('Додайте ФОП — усі його працівники з’являться окремими рядками.')}`;
}

export function renderHR() {
  const section = uiState.hrSection || 'employees';
  const content = section === 'orders' ? documents() : section === 'salary' ? salary() : employees();
  return `<div class="subnav" role="tablist"><button class="tab ${section === 'employees' ? 'active' : ''}" data-hr-section="employees">Наймані</button><button class="tab ${section === 'orders' ? 'active' : ''}" data-hr-section="orders">Документи по кадрам</button><button class="tab ${section === 'salary' ? 'active' : ''}" data-hr-section="salary">Виплата зарплати</button></div>${content}`;
}
