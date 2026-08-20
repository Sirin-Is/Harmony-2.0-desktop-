// render/inactive.js
// Builds the "Неактивні" tab: clients hidden from Огляд/Оплати, with
// buttons to restore them or move them to the deleted-clients area.

import { escapeHtml } from '../utils';
import { rateText } from '../client-model';
import { getArchivedClients } from '../state.js';
import { table } from './layout.js';

export function renderInactive() {
  const rows = getArchivedClients().map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong></td>
    <td>${escapeHtml(item.group || '-')}</td>
    <td>${rateText(item)}</td>
    <td>${escapeHtml(item.inactiveReason || '-')}</td>
    <td>${item.deletionEligibleAt ? escapeHtml(item.deletionEligibleAt) : '-'}</td>
    <td class="right row-actions">
      <button class="secondary" data-restore-client="${escapeHtml(item.id)}">Активувати</button>
      ${item.deletionEligibleAt ? '' : `<button class="icon" data-request-delete-client="${escapeHtml(item.id)}" title="Подати запит на видалення">🗑</button>`}
    </td>
  </tr>`);
  return `<div class="toolbar"><p class="note">Неактивні ФОП не беруть участі в обліку. Після підтвердження видалення клієнт одразу переходить у «Видалені», доступні через Налаштування.</p></div>
    ${table(rows, ['ПІБ', 'Група', 'Ставка', 'Причина', 'Дата перенесення', 'Дії'])}`;
}
