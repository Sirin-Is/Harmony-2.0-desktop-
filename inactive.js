// render/inactive.js
// Builds the "Неактивні" tab: clients hidden from Огляд/Оплати, with
// buttons to restore them or delete them permanently.

import { escapeHtml } from '../utils.js';
import { rateText } from '../client-model.js';
import { getArchivedClients } from '../state.js';
import { table } from './layout.js';

export function renderInactive() {
  const rows = getArchivedClients().map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong></td>
    <td>${escapeHtml(item.group || '—')}</td>
    <td>${rateText(item)}</td>
    <td class="right row-actions">
      <button class="secondary" data-restore-client="${item.id}">Активувати</button>
      <button class="icon" data-delete-client="${item.id}" title="Видалити безповоротно">🗑</button>
    </td>
  </tr>`);
  return `<div class="toolbar"><p class="note">ФОП, приховані з обліку. Усі дані збережено — активуйте, щоб рядок знову з'явився в «Огляді» та «Оплатах» на тому ж місці.</p></div>
    ${table(rows, ['ПІБ', 'Група', 'Ставка', 'Дії'])}`;
}
