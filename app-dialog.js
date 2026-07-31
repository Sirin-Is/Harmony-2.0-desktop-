// Application-styled replacement for browser prompt/confirm dialogs.

import { escapeHtml } from './utils';
import { enhanceDateInputs } from './date-input.js';

let dialog = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  document.body.appendChild(dialog);
  return dialog;
}

/** Resolves with submitted field values, or null when the user cancels. */
export function openAppDialog({ title, message, fields = [], confirmText = 'Підтвердити', danger = false }) {
  const el = ensureDialog();
  return new Promise((resolve) => {
    const onCancel = (event) => { event.preventDefault(); close(); };
    const close = (value = null) => {
      el.removeEventListener('cancel', onCancel);
      el.close();
      resolve(value);
    };
    const inputs = fields.map((field) => `<label>${escapeHtml(field.label)}
      ${field.type === 'textarea' ? `<textarea data-dialog-field="${escapeHtml(field.key)}" ${field.required ? 'required' : ''}>${escapeHtml(field.value || '')}</textarea>` : field.type === 'select' ? `<select data-dialog-field="${escapeHtml(field.key)}" ${field.required ? 'required' : ''}>${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${option === field.value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>` : `<input data-dialog-field="${escapeHtml(field.key)}" type="${escapeHtml(field.type || 'text')}" value="${escapeHtml(field.value || '')}" ${field.required ? 'required' : ''} ${field.min ? `min="${escapeHtml(field.min)}"` : ''} ${field.max ? `max="${escapeHtml(field.max)}"` : ''} autocomplete="off" ${field.options ? `list="dialog-list-${escapeHtml(field.key)}"` : ''}>`}
      ${field.options ? `<datalist id="dialog-list-${escapeHtml(field.key)}">${field.options.map((option) => `<option value="${escapeHtml(option)}"></option>`).join('')}</datalist>` : ''}
    </label>`).join('');
    el.innerHTML = `<form method="dialog" class="app-dialog-form">
      <header><h2>${escapeHtml(title)}</h2><button type="button" class="close" data-dialog-cancel aria-label="Закрити">×</button></header>
      <p>${escapeHtml(message)}</p>
      <div class="app-dialog-fields">${inputs}</div>
      <footer><button type="button" class="secondary" data-dialog-cancel>Скасувати</button><button type="submit" class="${danger ? 'danger' : 'primary'}">${escapeHtml(confirmText)}</button></footer>
    </form>`;
    enhanceDateInputs(el);
    el.querySelectorAll('[data-dialog-cancel]').forEach((button) => button.addEventListener('click', () => close()));
    el.querySelectorAll('textarea[data-dialog-field]').forEach((textarea) => {
      const resize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
      textarea.addEventListener('input', resize); resize();
    });
    el.addEventListener('cancel', onCancel);
    el.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const values = Object.fromEntries(fields.map((field) => [field.key, el.querySelector(`[data-dialog-field="${field.key}"]`).value.trim()]));
      if (fields.some((field) => field.required && !values[field.key])) return;
      close(values);
    }, { once: true });
    el.showModal();
    el.querySelector('.generic-date-field, [data-dialog-field]:not(.date-native)')?.focus();
  });
}
