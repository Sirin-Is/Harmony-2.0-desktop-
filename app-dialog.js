// Application-styled replacement for browser prompt/confirm dialogs.

import { escapeHtml } from './utils';
import { enhanceDateInputs } from './date-input.js';

let dialog = null;
let activeClose = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  document.body.appendChild(dialog);
  return dialog;
}

/** Resolves with submitted field values, or null when the user cancels. */
export function openAppDialog({ title, message, fields = [], confirmText = 'Підтвердити', cancelText = 'Скасувати', danger = false }) {
  const el = ensureDialog();
  return new Promise((resolve) => {
    const onCancel = (event) => { event.preventDefault(); close(); };
    const close = (value = null) => {
      el.removeEventListener('cancel', onCancel);
      if (el.open) el.close();
      el.replaceChildren();
      if (activeClose === close) activeClose = null;
      resolve(value);
    };
    if (activeClose) activeClose();
    activeClose = close;
    const inputs = fields.map((field) => `<label>${escapeHtml(field.label)}
      ${field.type === 'checkboxes' ? `<div class="app-dialog-checklist" data-dialog-field="${escapeHtml(field.key)}">${(field.options || []).map((option) => `<label><input type="checkbox" value="${escapeHtml(option.value)}" ${option.checked !== false ? 'checked' : ''}>${escapeHtml(option.label)}</label>`).join('')}</div>` : field.type === 'textarea' ? `<textarea data-dialog-field="${escapeHtml(field.key)}" ${field.required ? 'required' : ''}>${escapeHtml(field.value || '')}</textarea>` : field.type === 'select' ? `<select data-dialog-field="${escapeHtml(field.key)}" ${field.required ? 'required' : ''}>${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${option === field.value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>` : `<input data-dialog-field="${escapeHtml(field.key)}" type="${escapeHtml(field.type || 'text')}" value="${escapeHtml(field.value || '')}" ${field.required ? 'required' : ''} ${field.min ? `min="${escapeHtml(field.min)}"` : ''} ${field.max ? `max="${escapeHtml(field.max)}"` : ''} ${field.minLength ? `minlength="${escapeHtml(field.minLength)}"` : ''} ${field.maxLength ? `maxlength="${escapeHtml(field.maxLength)}"` : ''} autocomplete="${escapeHtml(field.autocomplete || 'off')}" ${field.options ? `list="dialog-list-${escapeHtml(field.key)}"` : ''} ${field.manualEntry ? 'data-manual-entry' : ''}>`}
      ${field.options ? `<datalist id="dialog-list-${escapeHtml(field.key)}">${field.options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join('')}</datalist>` : ''}
    </label>`).join('');
    el.innerHTML = `<form method="dialog" class="app-dialog-form">
      <header><h2>${escapeHtml(title)}</h2><button type="button" class="close" data-dialog-cancel aria-label="Закрити">×</button></header>
      <p>${escapeHtml(message)}</p>
      <div class="app-dialog-fields">${inputs}</div>
      <footer><button type="button" class="secondary" data-dialog-cancel>${escapeHtml(cancelText)}</button><button type="submit" class="${danger ? 'danger' : 'primary'}">${escapeHtml(confirmText)}</button></footer>
    </form>`;
    enhanceDateInputs(el);
    el.querySelectorAll('[data-dialog-cancel]').forEach((button) => button.addEventListener('click', () => close()));
    el.querySelectorAll('textarea[data-dialog-field]').forEach((textarea) => {
      const resize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
      textarea.addEventListener('input', resize); resize();
    });
    el.querySelectorAll('[data-manual-entry]').forEach((input) => input.addEventListener('paste', (event) => {
      event.preventDefault();
    }));
    el.querySelectorAll('[data-manual-entry]').forEach((input) => input.addEventListener('drop', (event) => {
      event.preventDefault();
    }));
    el.addEventListener('cancel', onCancel);
    el.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const values = Object.fromEntries(fields.map((field) => {
        const input = el.querySelector(`[data-dialog-field="${field.key}"]`);
        const value = field.type === 'checkboxes' ? [...input.querySelectorAll('input:checked')].map((item) => item.value) : input.value;
        return [field.key, field.type === 'password' ? value : value.trim()];
      }));
      if (fields.some((field) => field.required && !values[field.key])) return;
      close(values);
    }, { once: true });
    el.showModal();
    el.querySelector('.generic-date-field, [data-dialog-field]:not(.date-native)')?.focus();
  });
}

/** A compact four-quarter editor for the client's group and rate timeline. */
export function openGroupPeriodsDialog({ year, periods = [], rateOptions = {} }) {
  const el = ensureDialog();
  const groupOptions = ['1', '2', '3', 'Загальна'];
  const optionsForGroup = (group, selectedRate = '') => (rateOptions[group] || []).map((option) => (
    `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selectedRate) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`
  )).join('');
  const periodRows = periods.map((period, index) => `<section class="group-period-row" data-period-row="${index}">
    <h3>${escapeHtml(period.label)}</h3>
    <div class="group-period-fields">
      <input type="date" data-period-start value="${escapeHtml(period.startDate)}" aria-label="Початок ${escapeHtml(period.label)}" required>
      <span class="group-period-dash" aria-hidden="true">—</span>
      <input type="date" data-period-end value="${escapeHtml(period.endDate)}" aria-label="Кінець ${escapeHtml(period.label)}" required>
      <select data-period-group aria-label="Група ЄП: ${escapeHtml(period.label)}">${groupOptions.map((group) => `<option value="${group}" ${group === period.group ? 'selected' : ''}>${group}</option>`).join('')}</select>
      <select data-period-rate aria-label="Ставка ЄП: ${escapeHtml(period.label)}">${optionsForGroup(period.group, period.rate)}</select>
    </div>
  </section>`).join('');
  return new Promise((resolve) => {
    const onCancel = (event) => { event.preventDefault(); close(); };
    const close = (value = null) => {
      el.removeEventListener('cancel', onCancel);
      el.classList.remove('group-periods-dialog');
      if (el.open) el.close();
      el.replaceChildren();
      if (activeClose === close) activeClose = null;
      resolve(value);
    };
    if (activeClose) activeClose();
    activeClose = close;
    el.classList.add('group-periods-dialog');
    el.innerHTML = `<form method="dialog" class="app-dialog-form group-periods-form">
      <header><h2>Періоди перебування на групах ЄП</h2><button type="button" class="close" data-dialog-cancel aria-label="Закрити">×</button></header>
      <p>Налаштуйте групу та ставку для кожного кварталу ${escapeHtml(year)} року.</p>
      <div class="group-periods-list">${periodRows}</div>
      <footer><button type="button" class="secondary" data-dialog-cancel>Скасувати</button><button type="submit" class="primary">Зберегти</button></footer>
    </form>`;
    enhanceDateInputs(el);
    el.querySelectorAll('[data-dialog-cancel]').forEach((button) => button.addEventListener('click', () => close()));
    el.querySelectorAll('[data-period-group]').forEach((select) => select.addEventListener('change', () => {
      const rate = select.closest('[data-period-row]')?.querySelector('[data-period-rate]');
      if (!rate) return;
      rate.innerHTML = optionsForGroup(select.value);
    }));
    el.addEventListener('cancel', onCancel);
    el.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const rows = [...el.querySelectorAll('[data-period-row]')].map((row, index) => ({
        label: periods[index].label,
        startDate: row.querySelector('[data-period-start]').value,
        endDate: row.querySelector('[data-period-end]').value,
        group: row.querySelector('[data-period-group]').value,
        rate: row.querySelector('[data-period-rate]').value,
      }));
      if (rows.some((row) => !row.startDate || !row.endDate)) return;
      close(rows);
    }, { once: true });
    el.showModal();
    el.querySelector('.generic-date-field')?.focus();
  });
}

/** Close any data-bearing dialog when the authenticated UI is locked. */
export function closeAppDialog() {
  if (activeClose) activeClose();
  else if (dialog) {
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
  }
}
