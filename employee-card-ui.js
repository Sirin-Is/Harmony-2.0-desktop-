import { getEmployeeById, getHrOrders, getSettings, getVisibleClients, saveEmployee, saveHrOrder } from './state.js';
import { normalizeEmployeeName, validateEmployee } from './employee-model.js';
import { enhanceDateInputs } from './date-input.js';
import { showToast } from './toast.js';

let dialog = null;

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text, className, label = '') {
  const node = element('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

function field(labelText, control) {
  const label = element('label');
  label.append(document.createTextNode(labelText), control);
  return label;
}

function input(name, value, { type = 'text', required = false } = {}) {
  const node = element('input');
  node.name = name;
  node.type = type;
  node.value = String(value || '');
  node.required = required;
  return node;
}

function select(name, value, options) {
  const node = element('select');
  node.name = name;
  options.forEach((option) => {
    const item = element('option', '', option);
    item.value = option;
    item.selected = option === value;
    node.appendChild(item);
  });
  return node;
}

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
  if (!documents.length) return element('p', 'empty', `За ${year} рік пов’язаних документів немає.`);

  const wrapper = element('div', 'table-wrap');
  const table = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');
  ['№', 'Дата', 'Документ', 'Відправлення ФОПу'].forEach((title) => headRow.appendChild(element('th', '', title)));
  head.appendChild(headRow);

  const body = element('tbody');
  documents.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).forEach((order) => {
    const sent = order.deliveryStatus === 'Надіслано';
    const row = element('tr');
    [order.number || '-', order.date || '-', order.subject || '-'].forEach((value) => row.appendChild(element('td', '', String(value))));
    const statusCell = element('td');
    const status = button(sent ? 'Надіслано' : 'Не надіслано', `delivery-status ${sent ? 'sent' : 'pending'}`);
    status.setAttribute('data-employee-order-status', String(order.id));
    status.setAttribute('aria-pressed', String(sent));
    statusCell.appendChild(status);
    row.appendChild(statusCell);
    body.appendChild(row);
  });
  table.append(head, body);
  wrapper.appendChild(table);
  return wrapper;
}

function renderDocumentsPanel(target, clientId, employee, year) {
  const years = documentYears(clientId, employee);
  const index = years.indexOf(year);
  const heading = element('div', 'employee-card-section-head');
  heading.append(element('h3', '', 'Пов’язані документи'), element('span', 'note', 'Статус можна змінити безпосередньо тут'));

  const navigation = element('div', 'employee-document-year-nav');
  navigation.setAttribute('aria-label', 'Рік кадрових документів');
  const previous = button('←', 'secondary', 'Попередній рік');
  previous.setAttribute('data-employee-doc-prev', '');
  previous.disabled = index <= 0;
  const next = button('→', 'secondary', 'Наступний рік');
  next.setAttribute('data-employee-doc-next', '');
  next.disabled = index < 0 || index >= years.length - 1;
  navigation.append(previous, element('strong', '', String(year)), next);

  target.replaceChildren(heading, navigation, documentRows(clientId, employee, year));
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

  const form = element('form', 'employee-card-form');
  form.method = 'dialog';
  const header = element('header');
  const title = element('div');
  title.append(element('p', '', 'Кадри'), element('h2', '', existing ? 'Картка працівника' : 'Новий працівник'));
  const headerClose = button('×', 'close', 'Закрити');
  headerClose.setAttribute('data-employee-card-close', '');
  header.append(title, headerClose);

  const fields = element('div', 'employee-card-fields');
  const clientSelect = element('select');
  clientSelect.name = 'clientId';
  clientSelect.disabled = Boolean(existing);
  clients.forEach((client) => {
    const option = element('option', '', String(client.name || ''));
    option.value = String(client.id);
    option.selected = client.id === clientId;
    clientSelect.appendChild(option);
  });
  fields.append(
    field('ФОП-роботодавець', clientSelect),
    field('ПІБ працівника', input('name', employee.name, { required: true })),
    field('Посада', input('position', employee.position, { required: true })),
    field('Дата прийняття', input('hireDate', employee.hireDate, { type: 'date', required: true })),
    field('Дата звільнення', input('dismissalDate', employee.dismissalDate, { type: 'date' })),
    field('Виплата ЗП', select('salaryPaymentMethod', employee.salaryPaymentMethod || 'Безготівкою', ['Безготівкою', 'Готівка'])),
  );

  const documentsSection = element('section', 'employee-card-documents');
  if (existing) {
    renderDocumentsPanel(documentsSection, clientId, employee, activeDocumentYear);
  } else {
    const documentsHeading = element('div', 'employee-card-section-head');
    documentsHeading.appendChild(element('h3', '', 'Пов’язані документи'));
    documentsSection.append(documentsHeading, element('p', 'empty', 'Документи можна пов’язати після створення працівника.'));
  }

  const footer = element('footer');
  const cancel = button('Скасувати', 'secondary');
  cancel.setAttribute('data-employee-card-close', '');
  const submit = button('Зберегти', 'primary');
  submit.type = 'submit';
  footer.append(cancel, submit);
  form.append(header, fields, documentsSection, footer);
  el.replaceChildren(form);

  enhanceDateInputs(el);
  el.querySelector('input[name="name"]')?.setAttribute('spellcheck', 'false');
  el.querySelectorAll('[data-employee-card-close]').forEach((node) => node.addEventListener('click', close));
  const bindDocumentPanel = () => {
    documentsSection.querySelectorAll('[data-employee-order-status]').forEach((node) => node.addEventListener('click', () => {
      const order = getHrOrders().find((item) => item.id === node.dataset.employeeOrderStatus);
      if (!order) return;
      const saved = saveHrOrder({ ...order, employeeId: employee.id, employeeName: employee.name, deliveryStatus: order.deliveryStatus === 'Надіслано' ? 'Не надіслано' : 'Надіслано' }, order.id);
      if (!saved) return;
      const sent = saved.deliveryStatus === 'Надіслано';
      node.textContent = sent ? 'Надіслано' : 'Не надіслано';
      node.classList.toggle('sent', sent);
      node.classList.toggle('pending', !sent);
      node.setAttribute('aria-pressed', String(sent));
      document.dispatchEvent(new CustomEvent('harmony:changed'));
    }));
    const moveYear = (direction) => {
      const years = documentYears(clientId, employee);
      const index = years.indexOf(activeDocumentYear);
      const next = years[index + direction];
      if (!next) return;
      activeDocumentYear = next;
      renderDocumentsPanel(documentsSection, clientId, employee, activeDocumentYear);
      bindDocumentPanel();
    };
    documentsSection.querySelector('[data-employee-doc-prev]')?.addEventListener('click', () => moveYear(-1));
    documentsSection.querySelector('[data-employee-doc-next]')?.addEventListener('click', () => moveYear(1));
  };
  if (existing) bindDocumentPanel();
  el.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, { once: true });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = {
      clientId: existing?.client?.id || String(formData.get('clientId') || ''),
      name: String(formData.get('name') || '').trim(),
      position: String(formData.get('position') || '').trim(),
      hireDate: String(formData.get('hireDate') || ''),
      dismissalDate: String(formData.get('dismissalDate') || ''),
      salaryPaymentMethod: String(formData.get('salaryPaymentMethod') || 'Безготівкою'),
    };
    const validation = validateEmployee(values);
    if (!validation.ok) { showToast(validation.reason, 'error'); return; }
    if (!saveEmployee(values, employeeId)) { showToast('Не вдалося зберегти працівника. Перевірте, чи немає дубліката ПІБ у цього ФОП.', 'error'); return; }
    close();
    document.dispatchEvent(new CustomEvent('harmony:changed'));
    showToast(existing ? 'Картку працівника оновлено.' : 'Працівника додано.', 'success');
  });
  el.showModal();
  el.querySelector('input[name="name"]')?.focus();
}
