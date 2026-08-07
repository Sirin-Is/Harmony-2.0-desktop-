// Recoverable recycle bin. It is intentionally hidden from normal navigation.

import { escapeHtml } from '../utils';
import { rateText } from '../client-model';
import { getDeletedClients } from '../state.js';
import { table } from './layout.js';

export function renderDeleted() {
  const rows = getDeletedClients().map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong></td>
    <td>${escapeHtml(item.group || '-')}</td>
    <td>${rateText(item)}</td>
    <td>${escapeHtml(item.deletedAt || '-')}</td>
    <td class="right row-actions">
      <button class="secondary" data-restore-deleted-client="${escapeHtml(item.id)}">Відновити</button>
      ${item.isTestRecord ? `<button class="danger" data-purge-test-client="${escapeHtml(item.id)}">Стерти назавжди</button>` : ''}
    </td>
  </tr>`);
  return `<div class="toolbar"><p class="note">Кошик: ці ФОП не видалені з бази й можуть бути відновлені. Остаточне стирання доступне лише для позначених тестових записів після окремого підтвердження.</p></div>
    ${table(rows, ['ПІБ', 'Група', 'Ставка', 'Дата видалення', 'Дії'])}`;
}
