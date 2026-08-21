// render/settings.js
// Builds the "Налаштування" tab: МЗП на рік і дедлайни (щомісячні для
// 1-2 груп, поквартальні для 3 групи й ЄСВ, дедлайни звітності).

import { escapeHtml, monthPeriodKey, MONTH_SHORT_UA } from '../utils';
import { getAuditOperations, getSettings, getClientById } from '../state.js';
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
  const { annual, quarterly, combined = {} } = getSettings().reportDeadlines;
  const qCells = SETTINGS_QUARTERS.map((q) => {
    const periodKey = `${workingYear}-${q.key}`;
    const value = quarterly[periodKey] || (workingYear === 2026 ? quarterly[q.key] : '') || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="report-quarterly" data-period="${periodKey}" value="${escapeHtml(value)}" aria-label="Звіт ${q.label}"></td>`;
  }).join('');
  const qHeads = SETTINGS_QUARTERS.map((q) => `<th>${q.label}</th>`).join('');
  const combinedCells = SETTINGS_QUARTERS.map((q) => {
    const periodKey = `${workingYear}-${q.key}`;
    const value = combined[periodKey] || (workingYear === 2026 ? combined[q.key] : '') || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="report-combined" data-period="${periodKey}" value="${escapeHtml(value)}" aria-label="Об’єднаний звіт ${q.label}"></td>`;
  }).join('');
  return `<div class="panel settings-panel">
    <h2>Дедлайни декларацій і звітів</h2>
    <div class="settings-block">
      <p class="settings-block-label">1-2 групи — раз на рік</p>
      <input type="date" class="settings-field compact-date" data-scope="report-annual" data-period="${workingYear}" value="${escapeHtml(annual[workingYear] || '')}" aria-label="Річний дедлайн звітності 1-2 груп" style="max-width:150px">
    </div>
    <div class="settings-block">
      <p class="settings-block-label">3 група — поквартально</p>
      <div class="table-wrap"><table class="table settings-table"><thead><tr>${qHeads}</tr></thead><tbody><tr>${qCells}</tr></tbody></table></div>
    </div>
    <div class="settings-block">
      <p class="settings-block-label">Об’єднані звіти — поквартально (40 календарних днів після завершення кварталу)</p>
      <div class="table-wrap"><table class="table settings-table"><thead><tr>${qHeads}</tr></thead><tbody><tr>${combinedCells}</tr></tbody></table></div>
    </div>
  </div>`;
}

function payrollDatesPanel() {
  const schedule = getSettings().payrollSchedule || {};
  const secondHalfDay = Number(schedule.secondHalfDay) || 7;
  const firstHalfDay = Number(schedule.firstHalfDay) || 22;
  return `<div class="panel settings-panel"><h2>Дати виплати зарплати</h2>
    <div class="payroll-schedule-summary"><label><input class="payroll-schedule-day" type="number" min="1" max="31" step="1" data-payroll-schedule="secondHalfDay" value="${secondHalfDay}" aria-label="День виплати за другу половину попереднього місяця"><strong>число</strong><span>за другу половину попереднього місяця</span></label><label><input class="payroll-schedule-day" type="number" min="1" max="31" step="1" data-payroll-schedule="firstHalfDay" value="${firstHalfDay}" aria-label="День виплати за першу половину поточного місяця"><strong>число</strong><span>за першу половину поточного місяця</span></label></div>
    <p class="note">Графік діє автоматично для кожного місяця. Якщо вказане число припадає на суботу чи неділю, виплата переноситься на попередній робочий день. У календарі такий перенос показується одразу правильною датою, без стрілки.</p></div>`;
}

function usersPanel() {
  const rows = (uiState.managedUsers || []).map((user) => `<tr><td>${escapeHtml(user.login || '-')}</td><td>${escapeHtml(user.displayName || '-')}</td><td>${escapeHtml(user.role || '-')}</td><td>${user.isActive ? 'Активний' : 'Вимкнений'}</td><td>${escapeHtml(user.email || '-')}</td><td><button type="button" class="secondary" data-manage-user="${escapeHtml(user.userId)}">${user.bound ? 'Змінити' : 'Прив’язати'}</button></td></tr>`).join('');
  return `<div class="panel settings-panel"><div class="toolbar"><div><h2>Користувачі</h2><p class="note">Логін визначає адміністратор. Під час входу користувач вводить лише логін і пароль.</p></div><button type="button" class="primary" data-create-user>+ Користувач</button></div><div class="table-wrap"><table class="table users-table"><thead><tr><th>Логін</th><th>Ім’я</th><th>Роль</th><th>Статус</th><th>Supabase Auth</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Користувачів не знайдено.</td></tr>'}</tbody></table></div></div>`;
}

function conflictPeriodLabel(period) {
  const value = String(period || '');
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (month) return `${MONTH_SHORT_UA[Number(month[2]) - 1]} ${month[1]}`;
  const named = /^(\d{4})-(q1|half|9m|year)$/.exec(value);
  if (named) return `${{ q1: 'I квартал', half: 'півріччя', '9m': '9 місяців', year: 'рік' }[named[2]]} ${named[1]}`;
  return /^\d{4}$/.test(value) ? `${value} рік` : value;
}

function conflictContext(item, local, remote, client, changedCount) {
  const payload = Object.keys(local).length ? local : remote;
  const key = String(local.key || remote.key || item.entityId || '');
  const keyParts = key.split('|');
  const period = payload.monthKey || payload.period || keyParts[2] || (['monthly_payments', 'income_records'].includes(item.entityType) ? keyParts[1] : '');
  const section = {
    clients: 'Картки клієнтів → картка ФОП', monthly_payments: 'Оплати', tax_records: 'Податки', income_records: 'Доходи',
    report_records: 'Декларації', calendar_events: 'Календар → Задачі', hr_orders: 'Кадри → Документи по кадрам',
    hr_monthly_documents: 'Кадри → Документи по кадрам', payroll_records: 'Кадри → Виплата зарплати',
    custom_columns: 'Картки клієнтів → колонки таблиці', audit_events: 'Журнал подій', settings: 'Налаштування',
  }[item.entityType] || item.entityType;
  const details = [{ label: 'Розділ', value: payload.section || section }];
  const clientName = payload.clientName || client?.name;
  if (clientName && clientName !== '-') details.push({ label: 'ФОП', value: clientName });
  if (period) details.push({ label: 'Період', value: conflictPeriodLabel(period) });
  if (item.entityType === 'tax_records') {
    details.push({ label: 'Група', value: `${keyParts[1] || '—'} група` });
    details.push({ label: 'Податок', value: { unified: 'Єдиний податок', military: 'Військовий збір', esv: 'ЄСВ' }[keyParts[3]] || keyParts[3] || '—' });
  }
  if (payload.employeeName) details.push({ label: 'Працівник', value: payload.employeeName });
  if (payload.paymentType) details.push({ label: 'Виплата', value: payload.paymentType });
  if (payload.field) details.push({ label: 'Поле журналу', value: payload.field });
  if (payload.description) details.push({ label: 'Подія', value: payload.description });
  details.push({ label: 'Відрізняється полів', value: String(changedCount) });
  return details;
}

function conflictsPanel() {
  const editable = uiState.currentUser?.role !== 'observer';
  const entityNames = { clients: 'Картка клієнта', custom_columns: 'Додаткова колонка', monthly_payments: 'Оплати', tax_records: 'Податки', income_records: 'Доходи', report_records: 'Декларації / об’єднані звіти', calendar_events: 'Задача календаря', hr_orders: 'Кадровий документ', hr_monthly_documents: 'Кадрові документи', payroll_records: 'Виплата зарплати', audit_events: 'Запис журналу', settings: 'Налаштування' };
  const fieldNames = { name: 'ПІБ', title: 'Назва', note: 'Примітка', eventDate: 'Дата', eventTime: 'Час', completedAt: 'Виконання', completedDates: 'Дати виконання', subtasks: 'Підзадачі', charged: 'Нарахування', paid: 'Сплата', queuedDate: 'Набрано в банку', paidDate: 'Дата сплати', submittedDate: 'Дата подання', exemption: 'Причина звільнення', status: 'Статус', deadline: 'Дедлайн', paymentDate: 'Дата виплати', paymentType: 'Тип виплати', amount: 'Сума виплати', pdfo: 'ПДФО', vz: 'Військовий збір', payrollDates: 'Зарплата → дати виплат', secondHalf: 'ІІ половина попереднього місяця', firstHalf: 'І половина поточного місяця', monthlyDeadlines: 'Податки → щомісячні дедлайни', quarterlyDeadlines: 'Податки → квартальні дедлайни', reportDeadlines: 'Декларації та звіти → дедлайни', group3: '3 група', esv: 'ЄСВ', annual: 'Річні декларації', quarterly: 'Квартальні декларації', combined: 'Об’єднані звіти', appearance: 'Зовнішній вигляд', fieldColor: 'Колір полів', fieldRadius: 'Заокруглення полів', fieldOpacity: 'Прозорість полів', fieldBorderOpacity: 'Прозорість рамок полів', workingYear: 'Робочий рік', minWage: 'МЗП', q1: 'I квартал', half: 'Півріччя', '9m': '9 місяців', year: 'Рік', position: 'Посада', hireDate: 'Дата прийняття', dismissalDate: 'Дата звільнення', subject: 'Суть документа', number: 'Номер документа', effectiveDate: 'Дата початку дії', deliveryStatus: 'Надіслано ФОПу', timesheetStatus: 'Табель робочого часу', payrollStatus: 'Розрахунково-платіжна відомість', cashStatementStatus: 'Відомість на виплату готівки' };
  const parse = (value) => { try { return JSON.parse(value); } catch { return {}; } };
  const displayValue = (value) => {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Так' : 'Ні';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${String(value).slice(8, 10)}.${String(value).slice(5, 7)}.${String(value).slice(0, 4)}`;
    if (Array.isArray(value)) return value.length ? value.map((entry) => typeof entry === 'object' ? JSON.stringify(entry) : String(entry)).join('; ') : 'Немає';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };
  const flatten = (value, prefix = '', result = {}) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.entries(value).forEach(([key, nested]) => flatten(nested, prefix ? `${prefix}.${key}` : key, result));
    else result[prefix] = value;
    return result;
  };
  const pathLabel = (path) => path.split('.').filter((part) => part !== 'value').map((part) => fieldNames[part] || part).join(' → ');
  const rows = (uiState.syncConflicts || []).map((item) => {
    const local = parse(item.localPayload); const remote = parse(item.remotePayload);
    const client = getClientById(local.clientId || remote.clientId || local.id || remote.id);
    const recordName = local.name || remote.name || local.title || remote.title || local.employeeName || remote.employeeName || client?.name || '';
    const localFlat = flatten(local); const remoteFlat = flatten(remote);
    const keys = [...new Set([...Object.keys(localFlat), ...Object.keys(remoteFlat)])].filter((key) => !/(^|\.)(id|clientId|updatedAt|completionUpdatedAt)$/.test(key) && JSON.stringify(localFlat[key]) !== JSON.stringify(remoteFlat[key]));
    const context = conflictContext(item, local, remote, client, keys.length);
    const comparison = keys.slice(0, 50).map((key) => `<tr><th>${escapeHtml(pathLabel(key))}</th><td>${escapeHtml(displayValue(localFlat[key]))}</td><td>${escapeHtml(displayValue(remoteFlat[key]))}</td></tr>`).join('');
    return `<article class="panel settings-panel sync-conflict-card">
    <div class="toolbar"><div><h2>${escapeHtml(entityNames[item.entityType] || item.entityType)}${recordName ? ` — ${escapeHtml(recordName)}` : ''}</h2><p class="note">Виявлено: ${escapeHtml(new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.detectedAt)))}. Один запис змінено у двох версіях; автоматичний перезапис зупинено.</p></div></div>
    <dl class="sync-conflict-context">${context.map(({ label, value }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
    ${item.localIsDeleted || item.remoteIsDeleted ? `<p class="sync-conflict-warning">${item.localIsDeleted ? 'Локальну версію видалено.' : 'Віддалену версію видалено.'}</p>` : ''}
    ${comparison ? `<div class="table-wrap sync-conflict-comparison"><table class="table"><thead><tr><th>Поле</th><th>На цьому пристрої</th><th>У хмарі</th></tr></thead><tbody>${comparison}</tbody></table></div>` : '<p class="note">Версії відрізняються службовими або вкладеними даними. Розгорніть деталі нижче.</p>'}
    <p class="note">Показано розділ, ФОП і лише ті поля, значення яких відрізняються. Службові ідентифікатори приховано.</p>
    ${editable ? `<div class="toolbar-actions"><button type="button" class="secondary" data-resolve-sync-conflict="${escapeHtml(item.id)}" data-resolution="local">Залишити локальну</button><button type="button" class="primary" data-resolve-sync-conflict="${escapeHtml(item.id)}" data-resolution="remote">Прийняти віддалену</button></div>` : '<p class="note">Спостерігач може переглядати конфлікти, але не вирішувати їх.</p>'}
  </article>`;
  }).join('');
  return rows || '<div class="panel settings-panel"><h2>Конфлікти синхронізації</h2><p class="note">Відкритих конфліктів немає.</p></div>';
}

function diagnosticsPanel() {
  const status = { success: 'Успішно', error: 'Помилка', skipped: 'Пропущено' };
  const operation = { push: 'Передано в хмару', pull: 'Отримано з хмари', sync: 'Синхронізація' };
  const dateTime = (value) => value ? new Intl.DateTimeFormat('uk-UA', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-';
  const rows = (uiState.syncLog || []).map((item) => `<tr><td>${dateTime(item.createdAt)}</td><td>${escapeHtml(operation[item.operation] || item.operation || '-')}</td><td>${escapeHtml(item.entityType || '-')}</td><td>${escapeHtml(item.entityId || '-')}</td><td>${escapeHtml(status[item.status] || item.status || '-')}</td><td class="audit-value">${escapeHtml(item.message || '-')}</td></tr>`).join('');
  const health = uiState.localDatabaseHealth;
  const relationshipIssues = uiState.localDatabaseIssues || [];
  const healthText = health ? `${health.detail} Перевірено: ${dateTime(health.checkedAt)}.` : 'Ще не перевірялася в цьому сеансі.';
  const relationshipText = relationshipIssues.length ? `Знайдено зв’язків, які потребують перевірки: ${relationshipIssues.length}. ${relationshipIssues.slice(0, 3).join(' ')}` : 'Зв’язки між ФОП і робочими записами коректні.';
  const healthPanel = `<div class="panel settings-panel"><div class="toolbar"><div><h2>Локальна база даних</h2><p class="note">${escapeHtml(healthText)}</p><p class="note">${escapeHtml(relationshipText)}</p></div><div class="toolbar-actions"><span class="pill ${health ? (health.ok && !relationshipIssues.length ? 'ok' : 'late') : 'warn'}">${health ? (health.ok && !relationshipIssues.length ? 'Справна' : 'Потрібна увага') : 'Не перевірено'}</span><button type="button" class="secondary" data-check-local-db>Перевірити цілісність</button></div></div></div>`;
  const localProtection = uiState.localStorageProtection;
  const protectionPanel = `<div class="panel settings-panel"><h2>Шифрування локальної бази</h2>${localProtection?.enabled ? '<p class="note">Windows EFS захищає локальну SQLite-базу для поточного профілю Windows.</p>' : `<p class="note">EFS не активний${localProtection?.detail ? `: ${escapeHtml(localProtection.detail)}` : '.'} Це діагностична перевірка шифрування файлу, а не окрема функція Harmony. Для захисту всього диска використовуйте BitLocker.</p>`}</div>`;
  return `${healthPanel}${protectionPanel}<div class="panel settings-panel"><div class="toolbar"><div><h2>Діагностика синхронізації</h2><p class="note">Останні 100 локальних операцій. Журнал зберігається лише на цьому пристрої та автоматично обмежується 5 000 записами.</p></div><button type="button" class="secondary" data-refresh-sync-log>Оновити</button></div><div class="table-wrap"><table class="table audit-table"><thead><tr><th>Час</th><th>Операція</th><th>Розділ</th><th>ID запису</th><th>Статус</th><th>Деталі</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Записів синхронізації ще немає.</td></tr>'}</tbody></table></div></div>`;
}

function settingsTabs() {
  const admin = uiState.currentUser?.role === 'administrator';
  return `<div class="subnav"><button class="tab ${uiState.settingsSection === 'general' ? 'active' : ''}" data-settings-section="general">Загальні</button><button class="tab ${uiState.settingsSection === 'deadlines' ? 'active' : ''}" data-settings-section="deadlines">Автоматичні дедлайни</button><button class="tab ${uiState.settingsSection === 'dropdowns' ? 'active' : ''}" data-settings-section="dropdowns">Випадаючі списки</button><button class="tab ${uiState.settingsSection === 'appearance' ? 'active' : ''}" data-settings-section="appearance">Зовнішній вигляд</button><button class="tab ${uiState.settingsSection === 'conflicts' ? 'active' : ''}" data-settings-section="conflicts">Конфлікти</button>${admin ? `<button class="tab ${uiState.settingsSection === 'headings' ? 'active' : ''}" data-settings-section="headings">Шапки розділів</button><button class="tab ${uiState.settingsSection === 'diagnostics' ? 'active' : ''}" data-settings-section="diagnostics">Діагностика</button><button class="tab ${uiState.settingsSection === 'users' ? 'active' : ''}" data-settings-section="users">Користувачі</button>` : ''}</div>`;
}

const SECTION_HEADINGS = [
  ['overview', 'Огляд', 'Контроль ситуації'], ['dashboard', 'Картки клієнтів', 'Картки клієнтів ФОП'], ['payments', 'Оплати', 'Оплати бухгалтерських послуг'], ['taxes', 'Податки', 'Сплата податків по групах ЄП'], ['incomes', 'Доходи', 'Облік доходів і залишку ліміту'], ['reports', 'Декларації', 'Декларації по доходам'], ['combinedReports', 'Об’єднані звіти', 'Об’єднані звіти'], ['calendar', 'Календар', 'Задачі та автоматичні дедлайни'], ['activities', 'Види діяльності', 'Довідники КВЕД-2010 та NACE 2.1-UA'], ['hr', 'Кадри', 'Наймані працівники та кадрові документи'], ['inactive', 'Неактивні', 'Приховані ФОП'], ['deleted', 'Видалені', 'Кошик — відновлення ФОП'], ['settings', 'Налаштування', 'Налаштування'], ['audit', 'Журнал подій', 'Історія змін і відкат'],
];

function headingsPanel() {
  const configured = getSettings().sectionHeadings || {};
  const rows = SECTION_HEADINGS.map(([key, defaultCrumb, defaultTitle]) => {
    const value = configured[key] || {};
    return `<tr><td>${escapeHtml(defaultCrumb)}</td><td><input data-section-heading="${key}" data-heading-part="crumb" value="${escapeHtml(value.crumb || defaultCrumb)}" aria-label="Назва розділу ${escapeHtml(defaultCrumb)}"></td><td><input data-section-heading="${key}" data-heading-part="title" value="${escapeHtml(value.title || defaultTitle)}" aria-label="Пояснення до розділу ${escapeHtml(defaultCrumb)}"></td></tr>`;
  }).join('');
  return `<div class="panel settings-panel"><h2>Шапки розділів</h2><div class="table-wrap"><table class="table settings-table"><thead><tr><th>Розділ</th><th>Назва</th><th>Заголовок</th></tr></thead><tbody>${rows}</tbody></table></div><div class="toolbar-actions" style="margin-top:12px"><button type="button" class="primary" data-save-section-headings>Зберегти</button></div></div>`;
}

function dropdownsPanel() {
  const options = getSettings().dropdownOptions || {};
  const field = (key, label) => `<section class="dropdown-settings-list"><h3>${label}</h3><div data-dropdown-list="${key}">${[...(options[key] || []), ''].map((value) => `<input class="dropdown-options" data-dropdown-options="${key}" value="${escapeHtml(value)}" placeholder="Новий варіант">`).join('')}</div><button type="button" class="secondary dropdown-add" data-add-dropdown-option="${key}">Додати</button></section>`;
  return `<div class="panel settings-panel"><h2>Випадаючі списки</h2><p class="note">Кожен варіант — в окремому полі. Додавайте нові поля кнопкою «Додати».</p>${field('prro', 'ПРРО / РРО')}${field('currency', 'Валюта')}${field('kepIssuer', 'Видавці КЕП')}</div>`;
}

function activityReferencesPanel() {
  const imported = getSettings().activityReferences || {};
  return `<div class="panel settings-panel"><h2>Довідники видів діяльності</h2><p class="note">Завантажте актуальний КВЕД або NACE у форматі XLSX, XLS чи CSV. Обов’язкові колонки: «Код», «Назва», «1 група», «2 група», «3 група», «Примітка».</p><div class="toolbar-actions"><button type="button" class="secondary" data-download-activity-template>Завантажити приклад</button><button type="button" class="secondary" data-import-activity-reference="kved">Завантажити КВЕД${imported.kved?.length ? ` (${imported.kved.length})` : ''}</button><button type="button" class="secondary" data-import-activity-reference="nace">Завантажити NACE${imported.nace?.length ? ` (${imported.nace.length})` : ''}</button><input id="activityReferenceFile" type="file" accept=".xlsx,.xls,.csv" hidden></div></div>`;
}

export function renderSettings() {
  if (uiState.settingsSection === 'users' && uiState.currentUser?.role === 'administrator') return `${settingsTabs()}${usersPanel()}`;
  const settings = getSettings();
  const workingYear = settings.workingYear;
  const appearance = settings.appearance || { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0, fieldBorderOpacity: 50 };
  const clientCardAppearance = { radius: Number(appearance.clientCardRadius ?? appearance.fieldRadius), opacity: Number(appearance.clientCardOpacity ?? appearance.fieldOpacity), borderOpacity: Number(appearance.clientCardBorderOpacity ?? appearance.fieldBorderOpacity ?? 50) };
  const rollbackSnapshotBytes = getAuditOperations().reduce((sum, item) => sum + (item.beforeSnapshot ? JSON.stringify(item.beforeSnapshot).length : 0), 0);
  const rollbackSnapshotSize = rollbackSnapshotBytes < 1024 * 1024
    ? `${Math.round(rollbackSnapshotBytes / 1024)} КБ`
    : `${(rollbackSnapshotBytes / (1024 * 1024)).toFixed(1)} МБ`;
  const colors = ['#ffffff', '#dbeafe', '#dcfce7', '#fef3c7', '#ffe4e6', '#f3e8ff', '#cffafe', '#e0f2fe', '#ecfccb', '#ffedd5', '#e5e7eb', '#fce7f3'];
  const appearancePanel = `<div class="panel settings-panel appearance-panel"><h2>Зовнішній вигляд</h2>
    <label>Колір полів<span class="appearance-swatches">${colors.map((color) => `<input type="radio" name="fieldColor" data-appearance="fieldColor" value="${color}" ${appearance.fieldColor === color ? 'checked' : ''} style="--swatch:${color}" aria-label="${color}">`).join('')}</span></label>
    <label>Заокруглення кутів<select data-appearance="fieldRadius">${[2, 4, 6, 9, 14].map((value) => `<option value="${value}" ${Number(appearance.fieldRadius) === value ? 'selected' : ''}>${value === 2 ? 'Майже прямі' : value === 14 ? 'Сильно заокруглені' : `${value}px`}</option>`).join('')}</select></label>
    <label>Прозорість полів<select data-appearance="fieldOpacity">${[0, 20, 40, 60, 80, 100].map((value) => `<option value="${value}" ${Number(appearance.fieldOpacity) === value ? 'selected' : ''}>${value === 0 ? '0% — непрозорі' : value === 100 ? '100% — повністю прозорі' : `${value}%`}</option>`).join('')}</select></label>
    <label>Прозорість рамок<select data-appearance="fieldBorderOpacity">${[0, 20, 40, 60, 80, 100].map((value) => `<option value="${value}" ${Number(appearance.fieldBorderOpacity ?? 50) === value ? 'selected' : ''}>${value === 0 ? '0% — чорні' : value === 100 ? '100% — без рамок' : `${value}%`}</option>`).join('')}</select></label>
    <div class="appearance-client-card-settings"><h3>Картки клієнтів</h3><label>Заокруглення кутів<select data-appearance="clientCardRadius">${[2, 4, 6, 9, 14].map((value) => `<option value="${value}" ${clientCardAppearance.radius === value ? 'selected' : ''}>${value === 2 ? 'Майже прямі' : value === 14 ? 'Сильно заокруглені' : `${value}px`}</option>`).join('')}</select></label><label>Прозорість полів<select data-appearance="clientCardOpacity">${[0, 20, 40, 60, 80, 100].map((value) => `<option value="${value}" ${clientCardAppearance.opacity === value ? 'selected' : ''}>${value === 0 ? '0% — непрозорі' : value === 100 ? '100% — повністю прозорі' : `${value}%`}</option>`).join('')}</select></label><label>Прозорість рамок<select data-appearance="clientCardBorderOpacity">${[0, 20, 40, 60, 80, 100].map((value) => `<option value="${value}" ${clientCardAppearance.borderOpacity === value ? 'selected' : ''}>${value === 0 ? '0% — чорні' : value === 100 ? '100% — без рамок' : `${value}%`}</option>`).join('')}</select></label></div>
    <div class="appearance-preview" id="appearancePreview"><span>Зразок поля</span><input type="text" value="Текстове поле" aria-label="Зразок текстового поля"><select aria-label="Зразок списку"><option>Випадаючий список</option></select></div>
    <div class="toolbar-actions"><button type="button" class="primary" data-save-appearance>Зберегти</button></div>
    <p class="note">До збереження зміни видно лише у зразку. Після збереження вони застосуються до всіх текстових полів, дат і списків.</p></div>`;
  const tabs = settingsTabs();
  if (uiState.settingsSection === 'appearance') return `${tabs}${appearancePanel}`;
  if (uiState.settingsSection === 'dropdowns') return `${tabs}${dropdownsPanel()}`;
  if (uiState.settingsSection === 'headings' && uiState.currentUser?.role === 'administrator') return `${tabs}${headingsPanel()}`;
  if (uiState.settingsSection === 'conflicts') return `${tabs}${conflictsPanel()}`;
  if (uiState.settingsSection === 'diagnostics' && uiState.currentUser?.role === 'administrator') return `${tabs}${diagnosticsPanel()}`;
  if (uiState.settingsSection === 'deadlines') return `${tabs}<div class="toolbar"><p class="note">Ці дати є спільними для всіх розділів Harmony. Зміна тут одразу застосовується до «Податків», «Декларацій», «Об’єднаних звітів» та календаря; індивідуальний дедлайн ФОП залишається винятком.</p></div><div class="panel settings-panel"><h2>Податки — ${workingYear}</h2>${monthlyDeadlineBlock(workingYear)}${quarterlyDeadlineRow('group3', 'ЄП + ВЗ, 3 група', workingYear)}${quarterlyDeadlineRow('esv', 'ЄСВ, усі групи', workingYear)}</div>${reportDeadlineBlock(workingYear)}`;
  return `${tabs}<div class="toolbar"><p class="note">МЗП застосовується до ліміту доходу у формі ФОП і в «Доходах». Дедлайни розраховуються автоматично за правилами ПКУ; у таблицях «Податки», «Декларації» та «Об’єднані звіти» можна задати виняток лише для конкретного ФОП.</p></div>
    <div class="panel settings-panel">
      <h2>Робочий період</h2>
      <label class="settings-mzp">Рік<select id="f_workingYear">${settings.availableWorkingYears.map((year) => `<option value="${year}" ${year === workingYear ? 'selected' : ''}>${year}</option>`).join('')}</select></label>
      <div class="toolbar-actions" style="margin-top:8px"><button type="button" class="secondary" data-create-working-year>Створити новий робочий період</button></div>
      <p class="note">Перемикає дані за місяцями, податками та звітністю на вибраний календарний рік. Новий період створюється окремою дією та починається з порожніх дедлайнів.</p>
    </div>
    ${activityReferencesPanel()}
    ${payrollDatesPanel()}
    <div class="panel settings-panel">
      <h2>Мінімальна заробітна плата (МЗП) — ${workingYear}</h2>
      <label class="settings-mzp">грн/міс<input id="f_minWage" type="text" inputmode="numeric" value="${settings.minWage}"></label>
    </div>
    <div class="panel settings-panel">
      <h2>Видалені</h2>
      <p class="note">Переглядайте та відновлюйте ФОП, перенесених із «Неактивних» до видалених.</p>
      <button type="button" class="secondary" data-open-deleted>Відкрити «Видалені»</button>
    </div>
    ${uiState.currentUser?.role === 'administrator' ? `<div class="panel settings-panel">
      <h2>Резервна копія</h2>
      <p class="note">Файл містить усі дані Harmony, включно з журналом подій. Відновлення замінює поточні локальні дані та буде синхронізоване з робочим простором.</p>
      <p class="note">Локальні знімки для відкату за останні 7 днів: ${rollbackSnapshotSize}. Вони не передаються в Supabase, але входять до резервної копії.</p>
      <p class="note">Нові резервні копії шифруються окремим паролем. Harmony не зберігає цей пароль, тому відновити файл без нього неможливо.</p>
      <div class="toolbar-actions"><button type="button" class="secondary" data-download-backup>Завантажити резервну копію</button><button type="button" class="danger" data-restore-backup>Відновити з резервної копії</button><input type="file" id="backupRestoreFile" accept="application/json,.json" hidden></div>
    </div>` : ''}`;
}
