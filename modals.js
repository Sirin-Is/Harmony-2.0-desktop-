// modals.js
// Форма редагування клієнта видалена звідси: її замінює client-card-ui.js
// (Картка клієнта). Тут лишається лише форма кастомної колонки — єдине,
// що досі використовує спільний <dialog id="modal">.

import { $, escapeHtml, fieldValue } from './utils';
import { addCustomColumn, updateCustomColumn } from './state.js';
import { validateCustomColumn } from './validation.js';
import { showToast } from './toast.js';

let activeSubmitHandler = null;

function modalEls() {
  return { dialog: $('#modal'), title: $('#modalTitle'), body: $('#modalBody'), errors: $('#modalErrors') };
}

function openModal(title, bodyHtml, submitHandler) {
  const { dialog, title: titleEl, body, errors } = modalEls();
  titleEl.textContent = title;
  body.innerHTML = bodyHtml;
  if (errors) { errors.hidden = true; errors.innerHTML = ''; }
  activeSubmitHandler = submitHandler;
  dialog.showModal();
}

export function closeModal() {
  activeSubmitHandler = null;
  $('#modal').close();
}

function showModalErrors(messages) {
  const { errors } = modalEls();
  if (!errors) return;
  errors.innerHTML = messages.map((message) => `<p>${escapeHtml(message)}</p>`).join('');
  errors.hidden = messages.length === 0;
}

/** Called by bootstrap.js on the modal form's submit event. Returns true if the modal should close. */
export function handleModalSubmit() {
  if (!activeSubmitHandler) return true;
  const result = activeSubmitHandler();
  if (result.errors.length) { showModalErrors(result.errors); return false; }
  result.warnings.forEach((warning) => showToast(warning, 'warn', 6000));
  return true;
}

export function openColumnForm(existing = {}) {
  const html = `
    <label class="wide">Назва колонки<input id="f_columnName" value="${escapeHtml(existing.name)}" required></label>
    <label>Тип даних<select id="f_columnType">
      <option value="text" ${existing.type === 'text' ? 'selected' : ''}>Текст</option>
      <option value="number" ${existing.type === 'number' ? 'selected' : ''}>Число</option>
      <option value="date" ${existing.type === 'date' ? 'selected' : ''}>Дата</option>
    </select></label>
  `;
  openModal(existing.id ? 'Змінити колонку' : 'Нова колонка', html, () => {
    const fields = { name: fieldValue('columnName'), type: fieldValue('columnType') };
    const { errors } = validateCustomColumn(fields);
    if (errors.length) return { errors, warnings: [] };
    if (existing.id) updateCustomColumn(existing.id, fields);
    else addCustomColumn(fields);
    return { errors: [], warnings: [] };
  });
}
