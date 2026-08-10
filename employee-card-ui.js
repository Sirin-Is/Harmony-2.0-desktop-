import { escapeHtml } from './utils.js';
import { getEmployeeById, getHrOrders, getSettings, getVisibleClients, saveEmployee, saveHrOrder } from './state.js';
import { normalizeEmployeeName, validateEmployee } from './employee-model.js';
import { enhanceDateInputs } from './date-input.js';
import { showToast } from './toast.js';

const esc = escapeHtml;
let dialog = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'employee-card-dialog';
  document.body.appendChild(dialog);
  return dialog;
}

function linkedDocuments(clientId, employee) {
  const name = normalizeEmployeeName(employee?.name);
  return getHrOrders().filter((order) => order.employeeId === employee?.id
    || (!order.employeeId && order.clientId === clientId && name && normalizeEmployeeName(order.employeeName) === name));
}

function documentYears(clientId, employee) {
  const configured = getSettings().availableWorkingYears || [getSettings().workingYear];
  const documented = linkedDocuments(clientId, employee).map((order) => Number(String(order.date || '').slice(0, 4))).filter(Number.isInteger);
  return [...new Set([...configured, ...documented, getSettings().workingYear])].sort((a, b) => a - b);
}

function documentRows(clientId, employee, year) {
  const documents = linkedDocuments(clientId, employee).filter((order) => String(order.date || '').startsWith(`${year}-`));
  if (!documents.length) return `<p class="empty">За ${year} рік пов’язаних документів немає.</p>`;
  const rows = documents.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map((order) => {
    const sent = order.deliveryStatus === 'Надіслано';
    return `<tr><td>${esc(order.number || '-')}</td><td>${esc(order.date || '-')}</td><td>${esc(order.subject || '-')}</td><td><button type="button" class="delivery-status ${sent ? 'sent' : 'pending'}" data-employee-order-status="${esc(order.id)}" aria-pressed="${sent}">${sent ? 'Надіслано' : 'Не надіслано'}</button></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="table"><thead><tr><th>№</th><th>Дата</th><th>Документ</th><th>Відправлення ФОПу</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function documentsPanel(clientId, employee, year) {
  const years = documentYears(clientId, employee); const index = years.indexOf(year);
  return `<div class="employee-card-section-head"><h3>Пов’язані документи</h3><span class="note">Статус можна змінити безпосередньо тут</span></div>
    <div class="employee-document-year-nav" aria-label="Рік кадрових документів"><button type="button" class="secondary" data-employee-doc-prev ${index <= 0 ? 'disabled' : ''} aria-label="Попередній рік">←</button><strong>${year}</strong><button type="button" class="secondary" data-employee-doc-next ${index < 0 || index >= years.length - 1 ? 'disabled' : ''} aria-label="Наступний рік">→</button></div>
    ${documentRows(clientId, employee, year)}`;
}

function close() {
  if (!dialog) return;
  if (dialog.open) dialog.close();
  dialog.replaceChildren();
}

export function closeEmployeeCard() { close(); }

export function openEmployeeCard(employeeId = null) {
  const existing = employeeId ? getEmployeeById(employeeId) : null;
  const clients = getVisibleClients();
  if (!clients.length) { showToast('Спочатку додайте активного ФОП.', 'warn'); return; }
  const employee = existing?.employee || { name: '', position: '', hireDate: '', dismissalDate: '' };
  const clientId = existing?.client?.id || clients[0].id;
  let activeDocumentYear = getSettings().workingYear;
  const el = ensureDialog();
  el.innerHTML = `<form method="dialog" class="employee-card-form">
    <header><div><p>Кадри</p><h2>${existing ? 'Картка працівника' : 'Новий працівник'}</h2></div><button type="button" class="close" data-employee-card-close aria-label="Закрити">×</button></header>
    <div class="employee-card-fields">
      <label>ФОП-роботодавець<select name="clientId" ${existing ? 'disabled' : ''}>${clients.map((client) => `<option value="${esc(client.id)}" ${client.id === clientId ? 'selected' : ''}>${esc(client.name)}</option>`).join('')}</select></label>
      <label>ПІБ працівника<input name="name" value="${esc(employee.name || '')}" required></label>
      <label>Посада<input name="position" value="${esc(employee.position || '')}" required></label>
      <label>Дата прийняття<input name="hireDate" type="date" value="${esc(employee.hireDate || '')}" required></label>
      <label>Дата звільнення<input name="dismissalDate" type="date" value="${esc(employee.dismissalDate || '')}"></label>
    </div>
    <section class="employee-card-documents">${existing ? documentsPanel(clientId, employee, activeDocumentYear) : '<div class="employee-card-section-head"><h3>Пов’язані документи</h3></div><p class="empty">Документи можна пов’язати після створення працівника.</p>'}</section>
    <footer><button type="button" class="secondary" data-employee-card-close>Скасувати</button><button type="submit" class="primary">Зберегти</button></footer>
  </form>`;
  enhanceDateInputs(el);
  el.querySelectorAll('[data-employee-card-close]').forEach((button) => button.addEventListener('click', close));
  const documentsSection = el.querySelector('.employee-card-documents');
  const bindDocumentPanel = () => {
    documentsSection.querySelectorAll('[data-employee-order-status]').forEach((button) => button.addEventListener('click', () => {
      const order = getHrOrders().find((item) => item.id === button.dataset.employeeOrderStatus);
      if (!order) return;
      const saved = saveHrOrder({ ...order, employeeId: employee.id, employeeName: employee.name, deliveryStatus: order.deliveryStatus === 'Надіслано' ? 'Не надіслано' : 'Надіслано' }, order.id);
      if (!saved) return;
      const sent = saved.deliveryStatus === 'Надіслано';
      button.textContent = sent ? 'Надіслано' : 'Не надіслано';
      button.classList.toggle('sent', sent); button.classList.toggle('pending', !sent); button.setAttribute('aria-pressed', String(sent));
      document.dispatchEvent(new CustomEvent('harmony:changed'));
    }));
    const moveYear = (direction) => {
      const years = documentYears(clientId, employee); const index = years.indexOf(activeDocumentYear); const next = years[index + direction];
      if (!next) return;
      activeDocumentYear = next; documentsSection.innerHTML = documentsPanel(clientId, employee, activeDocumentYear); bindDocumentPanel();
    };
    documentsSection.querySelector('[data-employee-doc-prev]')?.addEventListener('click', () => moveYear(-1));
    documentsSection.querySelector('[data-employee-doc-next]')?.addEventListener('click', () => moveYear(1));
  };
  if (existing) bindDocumentPanel();
  el.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, { once: true });
  el.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = {
      clientId: existing?.client?.id || String(form.get('clientId') || ''),
      name: String(form.get('name') || '').trim(), position: String(form.get('position') || '').trim(),
      hireDate: String(form.get('hireDate') || ''), dismissalDate: String(form.get('dismissalDate') || ''),
    };
    const validation = validateEmployee(fields);
    if (!validation.ok) { showToast(validation.reason, 'error'); return; }
    if (!saveEmployee(fields, employeeId)) { showToast('Не вдалося зберегти працівника. Перевірте, чи немає дубліката ПІБ у цього ФОП.', 'error'); return; }
    close(); document.dispatchEvent(new CustomEvent('harmony:changed')); showToast(existing ? 'Картку працівника оновлено.' : 'Працівника додано.', 'success');
  });
  el.showModal();
  el.querySelector('input[name="name"]')?.focus();
}
