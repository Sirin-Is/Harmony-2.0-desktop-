import { escapeHtml } from '../utils.js';
import { getHrOrders, getVisibleClients, getPayrollRecords } from '../state.js';
import { getHrMonthlyDocuments, getSettings } from '../state.js';
import { uiState } from '../ui-state.js';
import { MONTH_NAMES_UA, monthPeriodKey } from '../utils.js';
import { empty, table } from './layout.js';
import { calendarDateIconSvg } from '../date-input.js';
import { normalizeEmployeeName } from '../employee-model.js';
import { payrollPaymentTypes } from '../payroll-model.js';

const esc = escapeHtml;
const shortName = (name = '') => name.trim().split(/\s+/).slice(0, 2).join(' ') || '-';
const employeePayrollName = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts.slice(1).map((part) => `${part[0]}.`).join(' ')}` : parts[0] || '-';
};
const date = (value) => value ? new Intl.DateTimeFormat('uk-UA').format(new Date(`${value}T00:00:00`)) : '-';
const MONTH_NAMES_GENITIVE_UA = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

function employees() {
  const orders = getHrOrders();
  const rows = getVisibleClients().flatMap((client) => (client.employees || []).map((employee) => {
    const linked = orders.filter((order) => order.employeeId === employee.id || (!order.employeeId && order.clientId === client.id && normalizeEmployeeName(order.employeeName) === normalizeEmployeeName(employee.name)));
    const sent = linked.filter((order) => order.deliveryStatus === 'Надіслано').length;
    const documentStatus = linked.length ? `${sent}/${linked.length} надіслано` : 'Немає';
    return `<tr><td>${esc(shortName(client.name))}</td><td><button type="button" class="link-cell" data-open-employee="${esc(employee.id)}"><strong>${esc(employee.name || '-')}</strong></button></td><td>${esc(employee.position || '-')}</td><td>${date(employee.hireDate)}</td><td>${date(employee.dismissalDate)}</td><td>${esc(documentStatus)}</td></tr>`;
  }));
  return `<div class="toolbar"><button class="primary" data-add-employee>+ Працівник</button></div>${rows.length ? table(rows, ['ФОП', 'Працівник', 'Посада', 'Прийнято', 'Звільнено', 'Документи'], 'hr-table') : empty('Найманих працівників поки немає.')}`;
}

function orders(period) {
  const clients = new Map(getVisibleClients().map((client) => [client.id, client]));
  const rows = [...getHrOrders()].filter((order) => !period || !order.period || order.period === period).sort((a, b) => String(b.date).localeCompare(String(a.date))).map((order) => { const sent = order.deliveryStatus === 'Надіслано'; const context = `${order.number}, ${clients.get(order.clientId)?.name || 'ФОП'}`; return `<tr><td><strong>${esc(shortName(clients.get(order.clientId)?.name || '-'))}</strong></td><td>${esc(order.number)}</td><td>${date(order.date)}</td><td>${esc(order.subject)}</td><td>${esc(order.employeeName || '-')}</td><td>${date(order.effectiveDate)}</td><td><button class="delivery-status ${sent ? 'sent' : 'pending'}" data-toggle-order-delivery="${esc(order.id)}" title="Змінити статус" aria-pressed="${sent}" aria-label="Статус надсилання документа ${esc(context)}">${sent ? 'Надіслано' : 'Не надіслано'}</button></td><td class="row-actions"><button class="icon" data-edit-hr-order="${esc(order.id)}" title="Редагувати документ" aria-label="Редагувати документ ${esc(context)}">✎</button><button class="icon" data-delete-hr-order="${esc(order.id)}" title="Видалити документ" aria-label="Видалити документ ${esc(context)}">✕</button></td></tr>`; });
  return `<div class="toolbar"><button class="primary" data-add-hr-order>+ Документ</button></div>${rows.length ? table(rows, ['ФОП', '№', 'Дата', 'Суть документа', 'Працівник', 'Початок дії', 'Статус', ''], 'hr-table') : empty('Кадрових документів поки немає.')}`;
}

function statusButton(clientId, period, field, value, clientName, label) {
  const sent = value === 'Надіслано';
  return `<button class="delivery-status ${sent ? 'sent' : 'pending'}" data-hr-document="${esc(clientId)}" data-hr-period="${period}" data-hr-field="${field}" title="Змінити статус" aria-pressed="${sent}" aria-label="${esc(label)}: ${esc(clientName)}">${sent ? 'Надіслано' : 'Не надіслано'}</button>`;
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
    const hasCashEmployee = (client.employees || []).some((employee) => employee.salaryPaymentMethod === 'Готівка');
    const cashDocument = hasCashEmployee
      ? statusButton(client.id, period, 'cashStatementStatus', record.cashStatementStatus, client.name, 'Відомість на виплату готівки')
      : '-';
    return `<tr><td><strong>${esc(shortName(client.name))}</strong></td><td>${statusButton(client.id, period, 'timesheetStatus', record.timesheetStatus, client.name, 'Табель робочого часу')}</td><td>${statusButton(client.id, period, 'payrollStatus', record.payrollStatus, client.name, 'Розрахунково-платіжна відомість')}</td><td>${cashDocument}</td></tr>`;
  });
  return `<div class="toolbar"><div class="toolbar-actions"><button class="secondary" data-hr-doc-prev ${month === 1 ? 'disabled' : ''} aria-label="Попередній місяць">←</button><strong class="calendar-period">${MONTH_NAMES_UA[month - 1]} ${settings.workingYear}</strong><button class="secondary" data-hr-doc-next ${month === 12 ? 'disabled' : ''} aria-label="Наступний місяць">→</button></div></div>
    ${rows.length ? table(rows, ['ФОП', 'Табель робочого часу', 'Розрахунково-платіжна відомість', 'Відомість на виплату готівки'], 'hr-documents-table') : empty('ФОП із найманими працівниками поки немає.')}
    <section class="hr-orders-section"><h3>Накази</h3>${orders(period)}</section>`;
}

const money = (value) => Number(String(value || '').replace(/\s+/g, '').replace(',', '.')) || 0;
const payrollMoney = (value) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(money(value)).replace(/\u00a0/g, ' ');
const payrollDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '';
const input = (record, field) => {
  const labels = { paymentDate: 'Дата виплати', amount: 'Сума виплати на руки', pdfo: 'ПДФО', vz: 'Військовий збір', esv: 'ЄСВ' };
  const label = `${labels[field] || field}: ${record.employeeName || 'працівник'}`;
  return field === 'paymentDate'
    ? `<div class="payroll-date-control"><input class="payroll-field payroll-date-field" type="text" inputmode="numeric" maxlength="10" data-payroll-id="${esc(record.id)}" data-payroll-field="${esc(field)}" value="${esc(payrollDate(record[field]))}" placeholder="дд.мм.рррр" aria-label="${esc(label)}"><button type="button" class="payroll-date-picker" data-payroll-picker="${esc(record.id)}" title="Відкрити календар" aria-label="Відкрити календар: ${esc(record.employeeName || 'працівник')}">${calendarDateIconSvg}</button><input class="payroll-native-date" type="date" tabindex="-1" aria-hidden="true" data-payroll-id="${esc(record.id)}" data-payroll-native-date="${esc(record.id)}" value="${esc(record[field] || '')}"></div>`
    : `<input class="payroll-field payroll-money-field" inputmode="decimal" data-payroll-id="${esc(record.id)}" data-payroll-field="${esc(field)}" value="${esc(record[field] ? payrollMoney(record[field]) : '')}" placeholder="0,00" aria-label="${esc(label)}">`;
};
function salary() {
  const settings = getSettings();
  if (!uiState.payrollMonth) uiState.payrollMonth = new Date().getFullYear() === settings.workingYear ? new Date().getMonth() + 1 : 1;
  const month = uiState.payrollMonth;
  const period = monthPeriodKey(settings.workingYear, month);
  const clients = getVisibleClients();
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const employees = new Map(clients.flatMap((client) => (client.employees || []).map((employee) => [employee.id, employee])));
  const paymentType = (type) => type || `Виплата ЗП за другу половину ${MONTH_NAMES_GENITIVE_UA[month === 1 ? 11 : month - 2]}`;
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
    const orderA = Number(recordsA[0]?.clientOrder || 0); const orderB = Number(recordsB[0]?.clientOrder || 0);
    if (orderA || orderB) return orderA - orderB || String(names.get(recordsA[0].clientId)).localeCompare(String(names.get(recordsB[0].clientId)));
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
    const typeOptions = payrollPaymentTypes(period);
    const typeSelect = `<select class="payroll-type-select" data-payroll-type-id="${esc(batchRecords[0].id)}" aria-label="Тип виплати"><option value="${esc(type)}">${esc(type)}</option>${typeOptions.filter((option) => !type.includes(option)).map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join('')}</select>`;
    const headerRow = `<tr class="payroll-type-row"><td colspan="12"><span>Тип виплати:</span>${typeSelect}</td></tr>`;
    return [headerRow, ...[...byClient.values()].sort(clientChronology).flatMap((records) => records.sort(chronology).map((record, index) => {
    const clientId = record.clientId;
    const gross = money(record.amount) / 0.77;
    const check = (rate, value) => gross * rate - money(value);
    const result = (rate, value) => gross ? `<span class="payroll-check ${Math.abs(check(rate, value)) < 1 ? 'ok' : 'warn'}">${payrollMoney(check(rate, value))}</span>` : '-';
    const esvRate = Number(employees.get(record.employeeId)?.esvRate || record.esvRate || 22) / 100;
    const moveControls = `<span class="payroll-client-order"><button class="icon" data-move-payroll-client="${esc(record.id)}" data-move-direction="-1" title="Перемістити ФОП вище">↑</button><button class="icon" data-move-payroll-client="${esc(record.id)}" data-move-direction="1" title="Перемістити ФОП нижче">↓</button></span>`;
    const statusCell = index === 0 ? `<td rowspan="${records.length}"><select class="payroll-field payroll-status-field" data-payroll-id="${esc(record.id)}" data-payroll-field="status" aria-label="Статус виплати: ${esc(names.get(clientId) || record.clientName || 'ФОП')}"><option value="" ${record.status ? '' : 'selected'}></option>${['Набрано','Сплачено','Повідомлено','Сплачено невчасно'].map((s) => `<option ${record.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>` : '';
    return `<tr>${index === 0 ? `<td rowspan="${records.length}" class="payroll-date">${input(record, 'paymentDate')}</td><td rowspan="${records.length}" class="payroll-client">${moveControls}<strong>${esc(shortName(names.get(clientId) || record.clientName || '-'))}</strong></td>` : ''}<td><button class="icon payroll-delete" data-delete-payroll="${esc(record.id)}" data-payroll-employee="${esc(record.employeeName || 'Працівник')}" data-payroll-type="${esc(type)}" data-payroll-amount="${esc(record.amount || '')}" title="Видалити рядок" aria-label="Видалити зарплатний рядок: ${esc(record.employeeName || 'працівник')}">✕</button>${esc(employeePayrollName(record.employeeName))}</td><td>${input(record, 'amount')}</td><td>${input(record, 'pdfo')}</td><td>${input(record, 'vz')}</td><td>${input(record, 'esv')}</td>${statusCell}<td>${gross ? payrollMoney(gross) : '-'}</td><td>${result(.18, record.pdfo)}</td><td>${result(.05, record.vz)}</td><td>${result(esvRate, record.esv)}</td></tr>`;
    }))];
  });
  return `<div class="toolbar"><div class="toolbar-actions"><button class="secondary" data-payroll-prev ${month === 1 ? 'disabled' : ''} aria-label="Попередній місяць">←</button><strong class="calendar-period">${MONTH_NAMES_UA[month - 1]} ${settings.workingYear}</strong><button class="secondary" data-payroll-next ${month === 12 ? 'disabled' : ''} aria-label="Наступний місяць">→</button><button class="primary" data-add-payroll-client>+ Додати виплату</button><button class="secondary" data-add-payroll-employee>+ Працівник</button></div></div>${rows.length ? table(rows, ['Дата','ПІБ ФОП','ПІБ працівника','Сума виплати','ПДФО','ВЗ','ЄСВ','Статус','До оподатк.','Перев. ПДФО','Перев. ВЗ','Перев. ЄСВ'], 'payroll-table') : empty('Додайте виплату — усі працівники вибраного ФОП з’являться окремими рядками.')}`;
}

export function renderHR() {
  const section = uiState.hrSection || 'employees';
  const content = section === 'orders' ? documents() : section === 'salary' ? salary() : employees();
  return `<div class="subnav" role="tablist"><button class="tab ${section === 'employees' ? 'active' : ''}" data-hr-section="employees">Наймані</button><button class="tab ${section === 'orders' ? 'active' : ''}" data-hr-section="orders">Документи по кадрам</button><button class="tab ${section === 'salary' ? 'active' : ''}" data-hr-section="salary">Виплата зарплати</button></div>${content}`;
}
