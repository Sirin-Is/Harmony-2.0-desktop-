import { escapeHtml } from '../utils';
import { canRollbackChanges, getAuditEvents } from '../state.js';
import { uiState } from '../ui-state.js';
import { table } from './layout.js';

const shortDate = (value) => value ? new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short' }).format(new Date(value)) : '-';
const shortTime = (value) => value ? new Intl.DateTimeFormat('uk-UA', { timeStyle: 'short' }).format(new Date(value)) : '-';
const unique = (items) => [...new Set(items.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'uk'));
const options = (items, selected, placeholder) => `<option value="">${placeholder}</option>${items.map((item) => `<option value="${escapeHtml(item)}" ${item === selected ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;

export function renderAudit() {
  const allEvents = getAuditEvents();
  const query = (uiState.auditSearch || '').trim().toLocaleLowerCase('uk-UA');
  const events = allEvents.filter((item) => (
    (!query || [item.actor, item.section, item.clientName, item.field, item.oldValue, item.newValue].some((value) => String(value || '').toLocaleLowerCase('uk-UA').includes(query)))
    && (!uiState.auditType || item.type === uiState.auditType)
    && (!uiState.auditStatus || item.status === uiState.auditStatus)
    && (!uiState.auditSection || item.section === uiState.auditSection)
    && (!uiState.auditClient || item.clientId === uiState.auditClient)
    && (!uiState.auditActor || item.actor === uiState.auditActor)
    && (!uiState.auditDate || String(item.occurredAt || '').slice(0, 10) === uiState.auditDate)
  )).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const clients = [...new Map(allEvents.filter((item) => item.clientId).map((item) => [item.clientId, { id: item.clientId, name: item.clientName || '-' }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const clientOptions = `<option value="">Усі ФОП</option>${clients.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === uiState.auditClient ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
  const rows = events.map((item) => `<tr class="${item.status === 'cancelled' ? 'audit-cancelled' : ''}"><td>${shortDate(item.occurredAt)}</td><td>${shortTime(item.occurredAt)}</td><td>${escapeHtml(item.actor || '-')}</td><td>${escapeHtml(item.section || '-')}</td><td>${escapeHtml(item.clientName || '-')}</td><td>${escapeHtml(item.field || '-')}</td><td class="audit-value">${escapeHtml(item.oldValue || '-')}</td><td class="audit-value">${escapeHtml(item.newValue || '-')}</td><td>${item.status === 'cancelled' ? 'Скасовано' : 'Активна'}</td></tr>`);
  return `<div class="toolbar audit-toolbar"><div class="audit-filters"><input id="auditSearch" placeholder="Пошук у журналі" value="${escapeHtml(uiState.auditSearch || '')}"><select id="auditSection">${options(unique(allEvents.map((item) => item.section)), uiState.auditSection, 'Усі розділи')}</select><select id="auditClient">${clientOptions}</select><select id="auditActor">${options(unique(allEvents.map((item) => item.actor)), uiState.auditActor, 'Усі користувачі')}</select><input id="auditDate" type="date" value="${escapeHtml(uiState.auditDate || '')}" title="Дата"><select id="auditStatus"><option value="">Усі статуси</option><option value="active" ${uiState.auditStatus === 'active' ? 'selected' : ''}>Активні</option><option value="cancelled" ${uiState.auditStatus === 'cancelled' ? 'selected' : ''}>Скасовані</option></select>${canRollbackChanges() ? '<button class="secondary" data-audit-rollback>↶ Відкат змін</button>' : ''}</div></div>${table(rows, ['Дата', 'Час', 'Користувач', 'Розділ', 'ФОП', 'Поле', 'Попереднє значення', 'Нове значення', 'Статус'], 'audit-table')}`;
}
