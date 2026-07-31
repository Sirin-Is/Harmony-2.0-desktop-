import { escapeHtml } from '../utils.js';
import { getActivityReference } from '../data/activity-reference.js';
import { uiState } from '../ui-state.js';
import { empty, table } from './layout.js';

const esc = escapeHtml;
const status = (value, note) => {
  const limited = Boolean(note);
  if (value === 'так') return `<span class="activity-status allowed">${limited ? 'Так, з обмеженнями' : 'Дозволено'}</span>`;
  if (value === 'ні') return `<span class="activity-status forbidden">${limited ? 'Ні, з обмеженнями' : 'Заборонено'}</span>`;
  return '-';
};

function queryRows(rows, query, fields) {
  const normalized = query.trim().toLocaleLowerCase('uk-UA');
  if (!normalized) return rows;
  return rows.filter((row) => fields.some((index) => String(row[index] || '').toLocaleLowerCase('uk-UA').includes(normalized)));
}

function codeGroups(kind) {
  const data = getActivityReference()[kind];
  const rows = queryRows(data, uiState.activitiesSearch || '', [0, 1, 5]).map(([code, name, group1, group2, group3, note]) => `<tr>
    <td>${esc(code)}</td><td>${esc(name)}</td><td>${status(group1, note)}</td><td>${status(group2, note)}</td><td>${status(group3, note)}</td><td>${esc(note || '-')}</td>
  </tr>`);
  return rows.length ? table(rows, ['Код', 'Назва', '1 група', '2 група', '3 група', 'Примітка'], 'activities-table') : empty('За цим запитом кодів не знайдено.');
}

function correspondence() {
  const rows = queryRows(getActivityReference().mapping, uiState.activitiesSearch || '', [0, 1, 2, 3, 4, 5]).map(([kvedCode, kvedName, naceCode, naceName, type, detail]) => `<tr>
    <td>${esc(kvedCode)}</td><td>${esc(kvedName)}</td><td>${esc(naceCode)}</td><td>${esc(naceName)}</td><td>${esc(type || '-')}</td><td>${esc(detail || '-')}</td>
  </tr>`);
  return rows.length ? table(rows, ['КВЕД', 'Назва КВЕД', 'NACE', 'Назва NACE', 'Тип зміни', 'Пояснення'], 'activities-mapping-table') : empty('За цим запитом відповідників не знайдено.');
}

export function renderActivities() {
  const section = uiState.activitiesSection || 'kved';
  const data = getActivityReference();
  const loaded = data.kved.length && data.nace.length && data.mapping.length;
  const content = !loaded ? empty('Завантаження довідників…') : section === 'mapping' ? correspondence() : codeGroups(section === 'nace' ? 'nace' : 'kved');
  return `<div class="subnav" role="tablist">
    <button class="tab ${section === 'kved' ? 'active' : ''}" data-activities-section="kved">КВЕД і групи ЄП</button>
    <button class="tab ${section === 'mapping' ? 'active' : ''}" data-activities-section="mapping">Відповідність КВЕД — NACE</button>
    <button class="tab ${section === 'nace' ? 'active' : ''}" data-activities-section="nace">NACE і групи ЄП</button>
  </div>
  <div class="toolbar"><input id="activitiesSearch" class="search-input" value="${esc(uiState.activitiesSearch || '')}" placeholder="Пошук за кодом або назвою"></div>${content}`;
}
