// render/modals.js
// The single <dialog> element is reused for two forms: "Новий/Редагувати
// ФОП" and "Нова/Змінити колонка". This module owns building their HTML,
// reading their values back out, validating, and persisting through
// state.js. main.js only wires the dialog's submit/cancel/backdrop events
// and calls handleModalSubmit() when the form is submitted.

import { $, escapeHtml, fieldValue, moneyFormat } from '../utils.js';
import { db, upsertClient, addCustomColumn, updateCustomColumn, getCustomColumns } from '../state.js';
import { rateOptionsForGroup, groupLimitLabel } from '../client-model.js';
import { validateClient, validateCustomColumn } from '../validation.js';
import { showToast } from '../toast.js';

let activeSubmitHandler = null; // set by whichever form is currently open

function modalEls() {
  return {
    dialog: $('#modal'),
    title: $('#modalTitle'),
    body: $('#modalBody'),
    errors: $('#modalErrors'),
  };
}

function openModal(title, bodyHtml, submitHandler) {
  const { dialog, title: titleEl, body, errors } = modalEls();
  titleEl.textContent = title;
  body.innerHTML = bodyHtml;
  errors.hidden = true;
  errors.innerHTML = '';
  activeSubmitHandler = submitHandler;
  dialog.showModal();
}

export function closeModal() {
  activeSubmitHandler = null;
  $('#modal').close();
}

function showModalErrors(messages) {
  const { errors } = modalEls();
  errors.innerHTML = messages.map((message) => `<p>${escapeHtml(message)}</p>`).join('');
  errors.hidden = messages.length === 0;
}

/** Called by main.js on the modal form's submit event. Returns true if the modal should close. */
export function handleModalSubmit() {
  if (!activeSubmitHandler) return true;
  const result = activeSubmitHandler();
  if (result.errors.length) {
    showModalErrors(result.errors);
    return false;
  }
  result.warnings.forEach((warning) => showToast(warning, 'warn', 6000));
  return true;
}

// ---------------------------------------------------------------------------
// Client form
// ---------------------------------------------------------------------------

const CLIENT_FIELD_KEYS = [
  'name', 'status', 'group', 'rate', 'serviceCost', 'currency', 'phone', 'email',
  'contactLink', 'bankAccess', 'prro', 'employees', 'kepIssuer', 'kepExpiry',
  'taxOffice', 'banks', 'activities',
];

function customColumnInputsHtml(existing) {
  return getCustomColumns().map((column) => {
    const value = existing.customFields?.[column.id] || '';
    return `<label><span>${escapeHtml(column.name)}</span><input id="f_custom_${column.id}" type="${column.type}" value="${escapeHtml(value)}"></label>`;
  }).join('');
}

export function openClientForm(existing = {}) {
  const initialGroup = existing.group || '1';
  const html = `
    <label class="wide">ПІБ / назва ФОП<input id="f_name" value="${escapeHtml(existing.name)}" required></label>
    <label>Статус<select id="f_status"><option ${existing.status !== 'Не працюємо' ? 'selected' : ''}>Працюємо</option><option ${existing.status === 'Не працюємо' ? 'selected' : ''}>Не працюємо</option></select></label>
    <label>Група ЄП<select id="f_group">${['1', '2', '3', 'Загальна'].map((x) => `<option ${initialGroup === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Ставка ЄП<select id="f_rate"></select></label>
    <label>Ліміт доходу на рік (2026)<input id="f_limitDisplay" value="${groupLimitLabel(initialGroup, moneyFormat)}" readonly></label>
    <label>Вартість обслуговування, грн<input id="f_serviceCost" type="number" min="0" value="${escapeHtml(existing.serviceCost || '')}"></label>
    <label>Дохід у валюті<select id="f_currency"><option>${escapeHtml(existing.currency || 'немає')}</option><option>немає</option><option>USD</option><option>EUR</option></select></label>
    <label>Телефон<textarea id="f_phone" placeholder="Кожен номер з нового рядка">${escapeHtml(existing.phone)}</textarea></label>
    <label>Ел. пошта<input id="f_email" type="email" value="${escapeHtml(existing.email)}"></label>
    <label>Зв'язок (Telegram)<input id="f_contactLink" type="text" placeholder="https://t.me/username" value="${escapeHtml(existing.contactLink)}"></label>
    <label>Доступ до банку<select id="f_bankAccess"><option>${escapeHtml(existing.bankAccess || '—')}</option><option>є</option><option>немає</option><option>частково</option></select></label>
    <label>П/РРО<select id="f_prro"><option>${escapeHtml(existing.prro || '—')}</option><option>є</option><option>немає</option></select></label>
    <label>Наймані<select id="f_employees"><option>${escapeHtml(existing.employees || 'немає')}</option><option>є</option><option>немає</option></select></label>
    <label>Видавець КЕП<input id="f_kepIssuer" value="${escapeHtml(existing.kepIssuer)}"></label>
    <label>КЕП дійсний до<input id="f_kepExpiry" type="date" value="${escapeHtml(existing.kepExpiry)}"></label>
    <label class="wide">ДПІ<input id="f_taxOffice" value="${escapeHtml(existing.taxOffice)}"></label>
    <label class="wide">Банківські рахунки<textarea id="f_banks">${escapeHtml(existing.banks)}</textarea></label>
    <label class="wide">Види діяльності (КВЕД)<textarea id="f_activities">${escapeHtml(existing.activities)}</textarea></label>
    ${customColumnInputsHtml(existing)}
  `;

  openModal(existing.id ? 'Редагувати ФОП' : 'Новий ФОП', html, () => {
    const fields = Object.fromEntries(CLIENT_FIELD_KEYS.map((key) => [key, fieldValue(key)]));
    const { errors, warnings } = validateClient(fields, db.clients, existing.id || null);
    if (errors.length) return { errors, warnings: [] };

    fields.customFields = { ...(existing.customFields || {}) };
    getCustomColumns().forEach((column) => { fields.customFields[column.id] = fieldValue(`custom_${column.id}`); });
    upsertClient(fields, existing.id || null);
    return { errors: [], warnings };
  });

  wireRateAndLimitInputs(existing);
}

function wireRateAndLimitInputs(existing) {
  let selectedRate = existing.rate;
  const renderRateOptions = () => {
    const group = fieldValue('group');
    const groupOptions = rateOptionsForGroup(group);
    const selected = selectedRate ?? groupOptions[0].value;
    $('#f_rate').innerHTML = groupOptions.map((item) =>
      `<option value="${item.value}" ${String(item.value) === String(selected) ? 'selected' : ''}>${item.label}</option>`,
    ).join('');
  };
  renderRateOptions();
  $('#f_group').addEventListener('change', () => {
    selectedRate = undefined;
    renderRateOptions();
    $('#f_limitDisplay').value = groupLimitLabel(fieldValue('group'), moneyFormat);
  });
}


// ---------------------------------------------------------------------------
// Custom column form
// ---------------------------------------------------------------------------

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
