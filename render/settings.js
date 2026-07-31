// render/settings.js
// Builds the "Налаштування" tab: МЗП на рік і дедлайни (щомісячні для
// 1-2 груп, поквартальні для 3 групи й ЄСВ, дедлайни звітності).

import { escapeHtml, monthPeriodKey, MONTH_SHORT_UA } from '../utils';
import { getAuditOperations, getSettings } from '../state.js';
import { uiState } from '../ui-state.js';

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

function usersPanel() {
  const rows = (uiState.managedUsers || []).map((user) => `<tr><td>${escapeHtml(user.login || '-')}</td><td>${escapeHtml(user.displayName || '-')}</td><td>${escapeHtml(user.role || '-')}</td><td>${user.isActive ? 'Активний' : 'Вимкнений'}</td><td>${escapeHtml(user.email || '-')}</td><td><button type="button" class="secondary" data-manage-user="${escapeHtml(user.userId)}">${user.bound ? 'Змінити' : 'Прив’язати'}</button></td></tr>`).join('');
  return `<div class="panel settings-panel"><div class="toolbar"><div><h2>Користувачі</h2><p class="note">Логін визначає адміністратор. Під час входу користувач вводить лише логін і пароль.</p></div><button type="button" class="primary" data-create-user>+ Користувач</button></div><div class="table-wrap"><table class="table users-table"><thead><tr><th>Логін</th><th>Ім’я</th><th>Роль</th><th>Статус</th><th>Supabase Auth</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Користувачів не знайдено.</td></tr>'}</tbody></table></div></div>`;
}

function conflictsPanel() {
  const editable = uiState.currentUser?.role !== 'observer';
  const rows = (uiState.syncConflicts || []).map((item) => `<article class="panel settings-panel sync-conflict-card">
    <div class="toolbar"><div><h2>${escapeHtml(item.entityType)} · ${escapeHtml(item.entityId)}</h2><p class="note">Виявлено: ${escapeHtml(item.detectedAt)}. Автоматичний перезапис зупинено.</p></div></div>
    <div class="sync-conflict-values"><details><summary>Локальна версія (${escapeHtml(item.localUpdatedAt)})</summary><pre>${escapeHtml(item.localPayload)}</pre></details><details><summary>Віддалена версія (${escapeHtml(item.remoteUpdatedAt)})</summary><pre>${escapeHtml(item.remotePayload)}</pre></details></div>
    ${editable ? `<div class="toolbar-actions"><button type="button" class="secondary" data-resolve-sync-conflict="${escapeHtml(item.id)}" data-resolution="local">Залишити локальну</button><button type="button" class="primary" data-resolve-sync-conflict="${escapeHtml(item.id)}" data-resolution="remote">Прийняти віддалену</button></div>` : '<p class="note">Спостерігач може переглядати конфлікти, але не вирішувати їх.</p>'}
  </article>`).join('');
  return rows || '<div class="panel settings-panel"><h2>Конфлікти синхронізації</h2><p class="note">Відкритих конфліктів немає.</p></div>';
}

export function renderSettings() {
  if (uiState.settingsSection === 'users' && uiState.currentUser?.role === 'administrator') return `<div class="subnav"><button class="tab" data-settings-section="general">Загальні</button><button class="tab" data-settings-section="appearance">Зовнішній вигляд</button><button class="tab" data-settings-section="conflicts">Конфлікти</button><button class="tab active" data-settings-section="users">Користувачі</button></div>${usersPanel()}`;
  const settings = getSettings();
  const workingYear = settings.workingYear;
  const appearance = settings.appearance || { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 };
  const localProtection = uiState.localStorageProtection;
  const rollbackSnapshotBytes = getAuditOperations().reduce((sum, item) => sum + (item.beforeSnapshot ? JSON.stringify(item.beforeSnapshot).length : 0), 0);
  const rollbackSnapshotSize = rollbackSnapshotBytes < 1024 * 1024
    ? `${Math.round(rollbackSnapshotBytes / 1024)} КБ`
    : `${(rollbackSnapshotBytes / (1024 * 1024)).toFixed(1)} МБ`;
  const localProtectionPanel = `<div class="panel settings-panel"><h2>Захист локальних даних</h2>${localProtection?.enabled
    ? '<p class="note">Увімкнено Windows EFS. Локальна SQLite-база та її службові файли зашифровані для поточного профілю Windows; додатковий PIN не потрібен.</p>'
    : `<p class="note">Захист Windows EFS не активний${localProtection?.detail ? `: ${escapeHtml(localProtection.detail)}` : '.'} Дані залишаються доступними програмі, але для шифрування диска використайте BitLocker або запустіть Harmony у профілі Windows, де EFS доступний.</p>`}</div>`;
  const colors = ['#ffffff', '#dbeafe', '#dcfce7', '#fef3c7', '#ffe4e6', '#f3e8ff', '#cffafe', '#e0f2fe', '#ecfccb', '#ffedd5', '#e5e7eb', '#fce7f3'];
  const appearancePanel = `<div class="panel settings-panel appearance-panel"><h2>Зовнішній вигляд</h2>
    <label>Колір полів<span class="appearance-swatches">${colors.map((color) => `<input type="radio" name="fieldColor" data-appearance="fieldColor" value="${color}" ${appearance.fieldColor === color ? 'checked' : ''} style="--swatch:${color}" aria-label="${color}">`).join('')}</span></label>
    <label>Заокруглення кутів<select data-appearance="fieldRadius">${[2, 4, 6, 9, 14].map((value) => `<option value="${value}" ${Number(appearance.fieldRadius) === value ? 'selected' : ''}>${value === 2 ? 'Майже прямі' : value === 14 ? 'Сильно заокруглені' : `${value}px`}</option>`).join('')}</select></label>
    <label>Прозорість<select data-appearance="fieldOpacity">${[0, 20, 40, 60, 80, 100].map((value) => `<option value="${value}" ${Number(appearance.fieldOpacity) === value ? 'selected' : ''}>${value === 0 ? '0% — непрозорі' : value === 100 ? '100% — повністю прозорі' : `${value}%`}</option>`).join('')}</select></label>
    <div class="appearance-preview" id="appearancePreview"><span>Зразок поля</span><input type="text" value="Текстове поле" aria-label="Зразок текстового поля"><select aria-label="Зразок списку"><option>Випадаючий список</option></select></div>
    <div class="toolbar-actions"><button type="button" class="primary" data-save-appearance>Зберегти</button></div>
    <p class="note">До збереження зміни видно лише у зразку. Після збереження вони застосуються до всіх текстових полів, дат і списків.</p></div>`;
  const tabs = `<div class="subnav"><button class="tab ${!['appearance', 'users', 'conflicts'].includes(uiState.settingsSection) ? 'active' : ''}" data-settings-section="general">Загальні</button><button class="tab ${uiState.settingsSection === 'appearance' ? 'active' : ''}" data-settings-section="appearance">Зовнішній вигляд</button><button class="tab ${uiState.settingsSection === 'conflicts' ? 'active' : ''}" data-settings-section="conflicts">Конфлікти</button>${uiState.currentUser?.role === 'administrator' ? `<button class="tab ${uiState.settingsSection === 'users' ? 'active' : ''}" data-settings-section="users">Користувачі</button>` : ''}</div>`;
  if (uiState.settingsSection === 'appearance') return `${tabs}${appearancePanel}`;
  if (uiState.settingsSection === 'conflicts') return `${tabs}${conflictsPanel()}`;
  return `${tabs}<div class="toolbar"><p class="note">МЗП застосовується до ліміту доходу у формі ФОП і в «Доходах». Дедлайни розраховуються автоматично за правилами ПКУ; у таблицях «Податки» та «Звітність» можна задати виняток лише для конкретного ФОП.</p></div>
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
      <h2>Автоматичні дедлайни</h2>
      <p class="note">1-2 групи: ЄП і ВЗ — до 20 числа щомісяця; ЄСВ — до 20 числа після кварталу; річна декларація — 60 календарних днів після року. 3 група: декларація — 40, ЄП і ВЗ — 50 календарних днів після кварталу; ЄСВ — до 20 числа після кварталу.</p>
      <p class="note">Якщо законодавчий строк припадає на суботу або неділю, для внутрішнього контролю програма показує попередню п’ятницю. Офіційні святкові перенесення за потреби задавайте як індивідуальний виняток у відповідному рядку.</p>
    </div>
    <div class="panel settings-panel">
      <h2>Видалені</h2>
      <p class="note">Переглядайте та відновлюйте ФОП, що завершили 30-денний період очікування після запиту на видалення.</p>
      <button type="button" class="secondary" data-open-deleted>Відкрити «Видалені»</button>
    </div>
    ${localProtectionPanel}
    ${uiState.currentUser?.role === 'administrator' ? `<div class="panel settings-panel">
      <h2>Резервна копія</h2>
      <p class="note">Файл містить усі дані Harmony, включно з журналом подій. Відновлення замінює поточні локальні дані та буде синхронізоване з робочим простором.</p>
      <p class="note">Локальні знімки для відкату за останні 7 днів: ${rollbackSnapshotSize}. Вони не передаються в Supabase, але входять до резервної копії.</p>
      <p class="note">Нові резервні копії шифруються окремим паролем. Harmony не зберігає цей пароль, тому відновити файл без нього неможливо.</p>
      <div class="toolbar-actions"><button type="button" class="secondary" data-download-backup>Завантажити резервну копію</button><button type="button" class="danger" data-restore-backup>Відновити з резервної копії</button><input type="file" id="backupRestoreFile" accept="application/json,.json" hidden></div>
    </div>` : ''}`;
}
