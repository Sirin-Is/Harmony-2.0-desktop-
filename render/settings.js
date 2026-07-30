// render/settings.js
// Builds the "Налаштування" tab: МЗП на рік і дедлайни (щомісячні для
// 1-2 груп, поквартальні для 3 групи й ЄСВ, дедлайни звітності).

import { escapeHtml, monthPeriodKey, MONTH_SHORT_UA } from '../utils';
import { getSettings } from '../state.js';

const SETTINGS_QUARTERS = [{ key: 'q1', label: 'I кв.' }, { key: 'half', label: 'II кв.' }, { key: '9m', label: 'III кв.' }, { key: 'year', label: 'IV кв.' }];

function monthlyDeadlineHalfRow(monthsSlice, offset, workingYear) {
  const deadlines = getSettings().monthlyDeadlines;
  const cells = monthsSlice.map((short, i) => {
    const index = offset + i;
    const key = monthPeriodKey(workingYear, index + 1);
    const value = deadlines[key] || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="monthly" data-period="${key}" value="${escapeHtml(value)}" aria-label="Дедлайн ${short}"></td>`;
  }).join('');
  const heads = monthsSlice.map((short) => `<th>${short}</th>`).join('');
  return `<table class="table settings-table"><thead><tr>${heads}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}

function monthlyDeadlineBlock(workingYear) {
  return `<div class="settings-block">
    <p class="settings-block-label">Єдиний податок + Військовий збір (1-2 групи) — щомісячно</p>
    <div class="table-wrap">${monthlyDeadlineHalfRow(MONTH_SHORT_UA.slice(0, 6), 0, workingYear)}</div>
    <div class="table-wrap" style="margin-top:4px">${monthlyDeadlineHalfRow(MONTH_SHORT_UA.slice(6, 12), 6, workingYear)}</div>
  </div>`;
}

function quarterlyDeadlineRow(taxKey, label, workingYear) {
  const store = getSettings().quarterlyDeadlines[taxKey];
  const cells = SETTINGS_QUARTERS.map((q) => {
    const periodKey = `${workingYear}-${q.key}`;
    const value = store[periodKey] || (workingYear === 2026 ? store[q.key] : '') || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="quarterly" data-tax="${taxKey}" data-period="${periodKey}" value="${escapeHtml(value)}" aria-label="${label} ${q.label}"></td>`;
  }).join('');
  const heads = SETTINGS_QUARTERS.map((q) => `<th>${q.label}</th>`).join('');
  return `<div class="settings-block"><p class="settings-block-label">${label}</p><div class="table-wrap"><table class="table settings-table"><thead><tr>${heads}</tr></thead><tbody><tr>${cells}</tr></tbody></table></div></div>`;
}

function reportDeadlineBlock(workingYear) {
  const { annual, quarterly } = getSettings().reportDeadlines;
  const qCells = SETTINGS_QUARTERS.map((q) => {
    const periodKey = `${workingYear}-${q.key}`;
    const value = quarterly[periodKey] || (workingYear === 2026 ? quarterly[q.key] : '') || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="report-quarterly" data-period="${periodKey}" value="${escapeHtml(value)}" aria-label="Звіт ${q.label}"></td>`;
  }).join('');
  const qHeads = SETTINGS_QUARTERS.map((q) => `<th>${q.label}</th>`).join('');
  return `<div class="panel settings-panel">
    <h2>Дедлайни звітності</h2>
    <div class="settings-block">
      <p class="settings-block-label">1-2 групи — раз на рік</p>
      <input type="date" class="settings-field compact-date" data-scope="report-annual" data-period="${workingYear}" value="${escapeHtml(annual[workingYear] || '')}" aria-label="Річний дедлайн звітності 1-2 груп" style="max-width:150px">
    </div>
    <div class="settings-block">
      <p class="settings-block-label">3 група — поквартально</p>
      <div class="table-wrap"><table class="table settings-table"><thead><tr>${qHeads}</tr></thead><tbody><tr>${qCells}</tr></tbody></table></div>
    </div>
  </div>`;
}

export function renderSettings() {
  const settings = getSettings();
  const workingYear = settings.workingYear;
  return `<div class="toolbar"><p class="note">Ці значення застосовуються автоматично: МЗП — до ліміту доходу у формі ФОП і в «Доходах»; дедлайни — до колонки «Дедлайн» у «Податках» і «Звітності» (якщо для конкретного запису не вказано власного значення).</p></div>
    <div class="panel settings-panel">
      <h2>Робочий період</h2>
      <label class="settings-mzp">Рік<select id="f_workingYear">${settings.availableWorkingYears.map((year) => `<option value="${year}" ${year === workingYear ? 'selected' : ''}>${year}</option>`).join('')}</select></label>
      <div class="toolbar-actions" style="margin-top:8px"><button type="button" class="secondary" data-create-working-year>Створити новий робочий період</button></div>
      <p class="note">Перемикає дані за місяцями, податками та звітністю на вибраний календарний рік. Новий період створюється окремою дією та починається з порожніх дедлайнів.</p>
    </div>
    <div class="panel settings-panel">
      <h2>Мінімальна заробітна плата (МЗП) — ${workingYear}</h2>
      <label class="settings-mzp">грн/міс<input id="f_minWage" type="number" min="0" step="1" value="${settings.minWage}"></label>
    </div>
    <div class="panel settings-panel">
      <h2>Дедлайни податків — 1-2 групи (щомісячно, єдиний спільний дедлайн)</h2>
      ${monthlyDeadlineBlock(workingYear)}
    </div>
    <div class="panel settings-panel">
      <h2>Дедлайни податків — поквартально</h2>
      ${quarterlyDeadlineRow('group3', 'Єдиний податок + Військовий збір (3 група)', workingYear)}
      ${quarterlyDeadlineRow('esv', 'ЄСВ (1, 2 і 3 групи)', workingYear)}
    </div>
    ${reportDeadlineBlock(workingYear)}
    <div class="panel settings-panel">
      <h2>Видалені</h2>
      <p class="note">Переглядайте та відновлюйте ФОП, що завершили 30-денний період очікування після запиту на видалення.</p>
      <button type="button" class="secondary" data-open-deleted>Відкрити «Видалені»</button>
    </div>`;
}
