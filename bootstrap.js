// bootstrap.js
// Точка входу модульної версії застосунку. Замінює нижню, "клейову"
// частину app.js: показ boot-overlay на час завантаження бази, роутинг
// між вкладками, прив'язку всіх обробників подій, submit модалки.
//
// Бізнес-логіка сюди НЕ переноситься — лише виклики вже готових функцій
// з state.js / *-model.js / render/*.js.

import { $, todayIso } from './utils';
import { uiState } from './ui-state.js';
import {
  db, initDatabase, lockDatabase, refreshDatabaseFromSync, prepareDatabaseSwitch, undoLastAction, setAuditActor, setAccessRole, getClientById, deleteClientPermanently, purgeDeletedTestClients, archiveClient, requestClientDeletion, setClientLifecycle, reorderClients, setCustomFieldValue, replaceDatabase,
  setMonthlyPaymentField, autofillMonthlyCharges, setTaxField, setReportField, setCombinedReportField, setIncomeValue, importIncomeRows, autoCompleteTaxPeriod, getTaxField, getEffectiveTaxDeadline, getReportField, getEffectiveReportDeadline, getEffectiveCombinedReportDeadline,
  setWorkingYear, createWorkingYear, setMinWage, setMonthlyTaxDeadline, setQuarterlyTaxDeadline, setReportDeadline, setAppearanceSetting, setSectionHeadings, setDropdownOptions, setActivityReference, getSettings,
  deleteCustomColumn, getCustomColumns,
  copyTaxPeriodForward, getVisibleClients, getClientsByTaxTab, saveCalendarEvent, deleteCalendarEvent, toggleCalendarTask, addCalendarSubtask, toggleCalendarSubtask, deleteCalendarSubtask, canRollbackChanges, rollbackChangesAfter, rollbackRetentionStart, getCalendarEvents, getHrOrders, saveHrOrder, deleteHrOrder, setHrMonthlyDocumentStatus, addPayrollForClient, addPayrollEmployee, deletePayrollRecord, setPayrollField, setPayrollPaymentType, movePayrollClientInBatch,
  getDatabaseRelationshipIssues,
} from './state.js';
import { TAX_TYPES, previousPeriodKey, taxPeriodsFor, statusPillHtml, daysUntilLabel } from './tax-model.ts';
import { reportStatusPillHtml, reportDaysUntilLabel } from './report-model.ts';
import { setupTopScrollbars, bindTopScrollbarResize } from './render/layout.js';
import { renderOverview } from './render/overview.js';
import { renderDashboard } from './render/dashboard.js';
import { renderPayments, positionPaymentsTable } from './render/payments.js';
import { renderTaxes } from './render/taxes.js';
import { renderIncomes } from './render/incomes.js';
import { renderReports } from './render/reports.js';
import { renderCombinedReports } from './render/combined-reports.js';
import { renderCalendar } from './render/calendar.js';
import { renderActivities } from './render/activities.js';
import { renderHR } from './render/hr.js';
import { renderAudit } from './render/audit.js';
import { applyActivityReferenceOverrides, loadActivityReference, normalizeActivityCode } from './data/activity-reference.js';
import { renderInactive } from './render/inactive.js';
import { renderDeleted } from './render/deleted.js';
import { renderSettings } from './render/settings.js';
import { openColumnForm, handleModalSubmit, closeModal } from './modals.js';
import { openClientCard, closeClientCard } from './client-card-ui.js';
import { openEmployeeCard, closeEmployeeCard } from './employee-card-ui.js';
import { exportClientsToExcel, importClientsFromFile } from './import-export.js';
import { showToast, clearToasts } from './toast.js';
import { openAppDialog, closeAppDialog } from './app-dialog.js';
import { enhanceDateInputs } from './date-input.js';
import { openBatchKvedCheck } from './kved-validation.js';
import { signIn, signOut, signedInEmail } from './auth/session';
import { getCurrentHarmonyUser, listAuthenticationUsers, manageHarmonyUsers } from './auth/users';
import { checkLocalDatabase, getOpenSyncConflicts, getRecentSyncLog, hasPendingLocalChanges, requestSync, requestRestoreSync, resolveSyncConflict } from './storage.js';
import { invoke } from '@tauri-apps/api/core';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordPolicyError } from './password-policy.js';
import { check } from '@tauri-apps/plugin-updater';
import { getLocalStorageProtection } from './local-storage-protection.ts';
import { assertBackupFileSize, createEncryptedBackup, decryptBackup, isEncryptedBackup, validateBackupDatabase } from './backup-crypto.js';
import { payrollPaymentTypes, payrollDateForPaymentType } from './payroll-model.js';
import { readSpreadsheetRows, readSpreadsheetMatrix } from './spreadsheet-security.js';

const TITLES = {
  overview: ['Огляд', 'Контроль ситуації'],
  dashboard: ['Картки клієнтів', 'Картки клієнтів ФОП'],
  payments: ['Оплати', 'Оплати бухгалтерських послуг'],
  taxes: ['Податки', 'Сплата податків по групах ЄП'],
  incomes: ['Доходи', 'Облік доходів і залишку ліміту'],
  reports: ['Декларації', 'Декларації по доходам'],
  combinedReports: ['Об’єднані звіти', 'Об’єднані звіти'],
  calendar: ['Календар', 'Задачі та автоматичні дедлайни'],
  activities: ['Види діяльності', 'Довідники КВЕД-2010 та NACE 2.1-UA'],
  hr: ['Кадри', 'Наймані працівники та кадрові документи'],
  audit: ['Журнал подій', 'Історія змін і відкат'],
  inactive: ['Неактивні', 'Приховані ФОП'],
  deleted: ['Видалені', 'Кошик — відновлення ФОП'],
  settings: ['Налаштування', 'Налаштування'],
};

const VIEWS = {
  overview: renderOverview,
  dashboard: renderDashboard,
  payments: renderPayments,
  taxes: renderTaxes,
  incomes: renderIncomes,
  reports: renderReports,
  combinedReports: renderCombinedReports,
  calendar: renderCalendar,
  activities: renderActivities,
  hr: renderHR,
  audit: renderAudit,
  inactive: renderInactive,
  deleted: renderDeleted,
  settings: renderSettings,
};
let focusHeadingAfterRender = false;
let remoteRefreshTimer = null;

function scheduleRemoteUiRefresh(delay = 600) {
  clearTimeout(remoteRefreshTimer);
  remoteRefreshTimer = setTimeout(async () => {
    if (!uiState.currentUser || !db) return;
    const active = document.activeElement;
    const editing = active instanceof HTMLElement && active.matches('#content input, #content select, #content textarea, [contenteditable="true"]');
    if (editing || hasPendingLocalChanges()) {
      scheduleRemoteUiRefresh(800);
      return;
    }
    try {
      await refreshDatabaseFromSync();
      render();
    } catch (error) {
      console.error('Не вдалося оновити дані після синхронізації:', error);
    }
  }, delay);
}

function showBootOverlay(visible) {
  const el = document.getElementById('bootOverlay');
  if (el) el.hidden = !visible;
}

function setAuthError(message = '') {
  const error = $('#authError');
  error.textContent = message;
  error.hidden = !message;
}

function setAuthBusy(busy) {
  const form = $('#authForm');
  form.querySelectorAll('input, button').forEach((control) => { control.disabled = busy; });
  $('#authSubmit').textContent = busy ? 'Перевірка…' : 'Увійти';
}

function resetPrivateUiState() {
  uiState.currentUser = null;
  uiState.managedUsers = [];
  uiState.syncConflicts = [];
  uiState.syncLog = [];
  uiState.localDatabaseHealth = null;
  uiState.localDatabaseIssues = [];
  uiState.selectedClientIds.clear();
  uiState.pendingHighlightClientId = null;
  uiState.deletedSectionUnlocked = false;
  uiState.dashboardFilters = {};
  uiState.dashboardSearch = '';
  uiState.dashboardFilterOpen = null;
  uiState.view = 'overview';
}

function setAuthButtonLabel(label) {
  const button = $('#authBtn');
  const text = String(label || 'Вийти');
  const labelNode = button?.querySelector('.side-action-label');
  if (labelNode) labelNode.textContent = text;
  else if (button) button.textContent = text;
  if (button) {
    button.setAttribute('aria-label', text);
    button.title = text;
  }
}

/** Make the unauthenticated DOM an inert, data-free login surface. */
function setAuthenticatedUi(authenticated) {
  const shell = $('#appShell');
  document.body.classList.toggle('auth-locked', !authenticated);
  shell.hidden = !authenticated;
  shell.inert = !authenticated;
  shell.setAttribute('aria-hidden', String(!authenticated));
  $('#authGate').hidden = authenticated;
  if (authenticated) return;

  closeAppDialog();
  closeClientCard();
  closeEmployeeCard();
  closeModal();
  clearToasts();
  $('#content').replaceChildren();
  document.title = 'Harmony';
  $('#userIdentity').textContent = 'CRM для бухгалтера ФОП';
  setAuthButtonLabel('Вийти');
  resetPrivateUiState();
  $('#authForm').reset();
  requestAnimationFrame(() => $('#authLogin')?.focus());
}

function localDateTimeValue(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function downloadBackup() {
  if (!uiState.currentUser || !db) throw new Error('Потрібно авторизуватися.');
  const password = await openAppDialog({
    title: 'Зашифрувати резервну копію',
    message: 'Створіть окремий пароль щонайменше з 8 символів. Harmony не зберігає його й не зможе відновити файл без цього пароля.',
    fields: [
      { key: 'password', label: 'Пароль резервної копії', type: 'password', required: true },
      { key: 'confirmation', label: 'Повторіть пароль', type: 'password', required: true },
    ],
    confirmText: 'Створити копію',
  });
  if (!password) return;
  const backupPasswordError = passwordPolicyError(password.password);
  if (backupPasswordError) { showToast(`Ненадійний пароль резервної копії. ${backupPasswordError}`, 'error', 9000); return; }
  if (password.password !== password.confirmation) { showToast('Паролі не збігаються.', 'error'); return; }
  const backup = await createEncryptedBackup(db, password.password);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `harmony-backup-${todayIso()}.json`;
  link.click();
  // Some desktop webviews start the download on the next event-loop turn.
  // Revoke only afterwards so a large backup is never saved as an empty file.
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast('Зашифровану резервну копію завантажено. Пароль не зберігається в Harmony.', 'success', 7000);
}

function captureViewport() {
  return {
    pageX: window.scrollX,
    pageY: window.scrollY,
    tables: [...document.querySelectorAll('#content .table-wrap')].map((element) => ({
      key: `${element.querySelector('table')?.className || ''}|${element.closest('.panel')?.querySelector('h2')?.textContent || ''}`,
      left: element.scrollLeft,
      top: element.scrollTop,
    })),
  };
}

function restoreViewport(snapshot) {
  if (!snapshot) return;
  const byKey = new Map(snapshot.tables.map((entry) => [entry.key, entry]));
  document.querySelectorAll('#content .table-wrap').forEach((element) => {
    const key = `${element.querySelector('table')?.className || ''}|${element.closest('.panel')?.querySelector('h2')?.textContent || ''}`;
    const previous = byKey.get(key);
    if (previous) { element.scrollLeft = previous.left; element.scrollTop = previous.top; }
  });
  window.scrollTo(snapshot.pageX, snapshot.pageY);
}

export function render({ preserveViewport = true } = {}) {
  if (!uiState.currentUser || !db) { setAuthenticatedUi(false); return; }
  const viewport = preserveViewport ? captureViewport() : null;
  const defaults = TITLES[uiState.view];
  const configured = db.settings?.sectionHeadings?.[uiState.view] || {};
  const crumb = configured.crumb || defaults[0];
  const title = configured.title || defaults[1];
  $('#crumb').textContent = crumb;
  $('#title').textContent = title;
  document.title = `${title} — Harmony`;
  document.querySelectorAll('#nav button').forEach((item) => {
    const current = item.dataset.view === uiState.view;
    item.classList.toggle('active', current);
    if (current) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  $('#content').innerHTML = VIEWS[uiState.view]();
  document.querySelectorAll('#content .tab').forEach((tab) => tab.setAttribute('aria-pressed', String(tab.classList.contains('active'))));
  bindCurrentView();
  enhanceDateInputs($('#content'));
  applyAppearance();
  applyRoleAccess();
  requestAnimationFrame(() => {
    let movedToHighlight = false;
    setupTopScrollbars();
    if (uiState.view === 'payments') positionPaymentsTable();
    if (uiState.view === 'dashboard') positionDashboardFilterMenu();
    if (uiState.view === 'calendar') drawCalendarDeadlineTransfers();
    if (focusHeadingAfterRender) {
      focusHeadingAfterRender = false;
      $('#title')?.focus({ preventScroll: true });
    }
    if (uiState.pendingHighlightClientId) {
      movedToHighlight = true;
      const targetId = uiState.pendingHighlightClientId;
      uiState.pendingHighlightClientId = null;
      const rows = [...document.querySelectorAll('tr[data-row-id]')]
        .filter((row) => row.dataset.rowId === targetId);
      rows.forEach((row) => {
        row.classList.add('row-highlight');
        setTimeout(() => row.classList.remove('row-highlight'), 2600);
      });
      if (rows[0]?.scrollIntoView) rows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // A data refresh replaces table DOM.  Restore the user's actual reading
    // position afterwards, including during a background synchronization.
    if (!movedToHighlight) restoreViewport(viewport);
  });
}

function positionDashboardFilterMenu() {
  const menu = document.querySelector('[data-dashboard-filter-menu]');
  const trigger = document.querySelector(`[data-dashboard-filter="${CSS.escape(uiState.dashboardFilterOpen || '')}"]`);
  if (!menu || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = menu.offsetWidth || 230;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.min(rect.bottom + 5, window.innerHeight - menu.offsetHeight - 8)}px`;
}

function drawCalendarDeadlineTransfers() {
  const grid = document.querySelector('.calendar-grid');
  const layer = grid?.querySelector('.calendar-transfer-layer');
  if (!grid || !layer) return;
  const gridRect = grid.getBoundingClientRect();
  layer.setAttribute('viewBox', `0 0 ${gridRect.width} ${gridRect.height}`);
  layer.innerHTML = '<defs><marker id="deadline-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z"></path></marker></defs>';
  const ids = new Set([...grid.querySelectorAll('[data-transfer-role="statutory"]')].map((item) => item.dataset.transferId));
  ids.forEach((id) => {
    const statutory = grid.querySelector(`[data-transfer-id="${CSS.escape(id)}"][data-transfer-role="statutory"]`)?.closest('.calendar-cell');
    const control = grid.querySelector(`[data-transfer-id="${CSS.escape(id)}"][data-transfer-role="control"]`)?.closest('.calendar-cell');
    if (!statutory || !control) return;
    const from = statutory.getBoundingClientRect(); const to = control.getBoundingClientRect();
    const x1 = from.left - gridRect.left + 8; const x2 = to.right - gridRect.left - 8;
    const y1 = from.top - gridRect.top + 20; const y2 = to.top - gridRect.top + 20;
    const curveY = Math.max(4, Math.min(y1, y2) - 13);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${curveY}, ${x2} ${curveY}, ${x2} ${y2}`);
    path.setAttribute('marker-end', 'url(#deadline-arrow)');
    layer.appendChild(path);
  });
}

function applyRoleAccess() {
  const observer = uiState.currentUser?.role === 'observer';
  document.body.classList.toggle('observer-mode', observer);
  $('#quickNote').hidden = observer;
  if (!observer) return;
  document.querySelectorAll('#content input:not([data-dashboard-search]), #content select, #content textarea').forEach((field) => { field.disabled = true; });
  document.querySelectorAll('#content button.primary, #content button.danger, #content .icon, #content [data-export-clients], #content [data-import-clients]').forEach((button) => { button.disabled = true; });
  document.querySelectorAll('#content [data-drag-handle]').forEach((handle) => { handle.tabIndex = -1; handle.setAttribute('aria-disabled', 'true'); });
}

function applyAppearance(appearance = getSettings()?.appearance || { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 }, target = document.documentElement) {
  const hex = String(appearance.fieldColor || '#ffffff').replace('#', '');
  const rgb = hex.length === 6 ? `${parseInt(hex.slice(0, 2), 16)} ${parseInt(hex.slice(2, 4), 16)} ${parseInt(hex.slice(4, 6), 16)}` : '255 255 255';
  target.style.setProperty('--field-rgb', rgb);
  target.style.setProperty('--field-opacity', String(1 - Number(appearance.fieldOpacity ?? 0) / 100));
  target.style.setProperty('--field-radius', `${Number(appearance.fieldRadius ?? 5)}px`);
}

function setView(view) {
  if (!uiState.currentUser || !db) return;
  if (view === 'deleted' && !uiState.deletedSectionUnlocked) return;
  uiState.view = view;
  focusHeadingAfterRender = true;
  render({ preserveViewport: false });
}

function noteTitle(event) { return event?.title?.trim() || String(event?.note || '').trim().split(/\r?\n/)[0] || 'Без назви'; }

async function openNoteEditor(existing = null) {
  const recurrenceLabels = {
    none: 'Не повторювати', daily: 'Щодня', weekly: 'Щотижня', monthly: 'Щомісяця в це число', quarterly: 'Щокварталу в це число', yearly: 'Щороку в цю дату', months: 'Кожні N місяців',
  };
  const recurrence = existing?.recurrence || {};
  const recurrenceValue = recurrence.frequency || 'none';
  const result = await openAppDialog({
    title: existing ? 'Змінити задачу' : 'Нова задача',
    fields: [
      { key: 'title', label: 'Назва задачі', value: existing ? noteTitle(existing) : '', required: true },
      { key: 'taskType', label: 'Тип', type: 'select', value: existing?.taskType || 'Оперативні задачі', options: ['Звіти', 'Податки', 'Зарплата', 'Оперативні задачі', 'Комунікація'] },
      { key: 'client', label: 'ФОП (необов’язково)', value: existing ? (getClientById(existing.clientId)?.name || '') : '', options: getVisibleClients().map((item) => item.name) },
      { key: 'note', label: 'Опис задачі', type: 'textarea', value: existing?.note || '', required: true },
      { key: 'date', label: 'Дата події', type: 'date', value: existing?.eventDate || todayIso(), required: true },
      { key: 'time', label: 'Час події (необов’язково)', type: 'time', value: existing?.eventTime || '' },
      { key: 'recurrence', label: 'Повторення', type: 'select', value: recurrenceLabels[recurrenceValue], options: Object.values(recurrenceLabels) },
      { key: 'interval', label: 'Інтервал повтору (для «кожні N місяців»)', type: 'number', value: String(recurrence.interval || 1) },
      { key: 'until', label: 'Повторювати до (необов’язково)', type: 'date', value: recurrence.until || '' },
      { key: 'workdayShift', label: 'Якщо дата — вихідний', type: 'select', value: existing?.workdayShift === 'next' ? 'Перенести на наступний робочий день' : (existing?.workdayShift === 'previous' || recurrence.moveToPreviousWorkday ? 'Перенести на попередній робочий день' : 'Не переносити'), options: ['Не переносити', 'Перенести на попередній робочий день', 'Перенести на наступний робочий день'] },
    ],
    confirmText: 'Зберегти',
  });
  if (!result) return;
  const clientId = getVisibleClients().find((item) => item.name === result.client)?.id || '';
  const frequency = Object.entries(recurrenceLabels).find(([, label]) => label === result.recurrence)?.[0];
  const savedRecurrence = frequency && frequency !== 'none' ? {
    frequency,
    interval: Math.max(1, Number(result.interval) || 1),
    until: result.until || '',
    moveToPreviousWorkday: result.workdayShift === 'Перенести на попередній робочий день',
  } : undefined;
  const workdayShift = result.workdayShift === 'Перенести на попередній робочий день' ? 'previous' : result.workdayShift === 'Перенести на наступний робочий день' ? 'next' : undefined;
  const saved = saveCalendarEvent({ eventDate: result.date, eventTime: result.time || '', title: result.title, taskType: result.taskType, note: result.note, clientId, recurrence: savedRecurrence, workdayShift, completedAt: existing?.completedAt || '', completedDates: existing?.completedDates || [] }, existing?.id);
  if (!saved) { showToast('Перевірте дату, час та діапазон повторення задачі.', 'error'); return; }
  render();
}

async function openNoteViewer(event, occurrenceDate = '') {
  const recurring = event.recurrence?.frequency;
  const date = String(occurrenceDate || event.eventDate || '').split('-').reverse().join('.');
  const result = await openAppDialog({
    title: noteTitle(event),
    message: `ФОП: ${event.clientId ? getClientById(event.clientId)?.name || '-' : '-'}\nДата: ${date || '-'}\nЧас: ${event.eventTime || '-'}\nТип: ${recurring ? 'регулярна' : 'разова'}\n\nОпис:\n${event.note || '-'}`,
    confirmText: 'Редагувати',
  });
  if (result) openNoteEditor(event);
}

function bindCurrentView() {
  document.querySelector('[data-batch-activity-check]')?.addEventListener('click', openBatchKvedCheck);
  document.querySelectorAll('[data-calendar-section]').forEach((button) => button.addEventListener('click', () => {
    uiState.calendarSection = button.dataset.calendarSection;
    if (uiState.calendarSection === 'tasks' && !uiState.calendarTaskDate) {
      const year = getSettings().workingYear;
      const now = new Date();
      uiState.calendarTaskDate = now.getFullYear() === year
        ? `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        : `${year}-${String(uiState.calendarMonth || 1).padStart(2, '0')}-01`;
    }
    render();
  }));
  document.querySelector('[data-calendar-prev]')?.addEventListener('click', () => { uiState.calendarMonth = uiState.calendarMonth === 1 ? 12 : uiState.calendarMonth - 1; render(); });
  document.querySelector('[data-calendar-next]')?.addEventListener('click', () => { uiState.calendarMonth = uiState.calendarMonth === 12 ? 1 : uiState.calendarMonth + 1; render(); });
  document.querySelector('[data-calendar-today]')?.addEventListener('click', () => {
    const now = new Date();
    const year = getSettings().workingYear;
    uiState.calendarMonth = now.getFullYear() === year ? now.getMonth() + 1 : 1;
    uiState.calendarTaskDate = now.getFullYear() === year ? todayIso() : `${year}-01-01`;
    render();
  });
  document.querySelectorAll('[data-calendar-day]').forEach((cell) => {
    const openDay = () => { uiState.calendarTaskDate = cell.dataset.calendarDay; uiState.calendarSection = 'tasks'; render(); };
    cell.addEventListener('click', openDay);
    cell.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openDay();
    });
  });
  document.querySelectorAll('[data-calendar-event]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = button.dataset.calendarTarget;
    if (target) {
      const [, group, period] = target.split('|');
      uiState.taxGroup = group; uiState.taxPeriod = period;
      setView('taxes'); return;
    }
    const noteEvent = getCalendarEvents().find((item) => item.id === button.dataset.calendarEvent);
    if (noteEvent) openNoteViewer(noteEvent, button.dataset.calendarOccurrence);
  }));
  document.querySelectorAll('[data-delete-note]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const recurring = button.dataset.deleteNoteRecurring === 'true';
    const result = await openAppDialog({ title: recurring ? 'Видалити повторювану задачу' : 'Видалити задачу', message: recurring ? 'Буде видалено всю серію повторюваних задач.' : 'Задачу буде видалено.', confirmText: 'Видалити', danger: true });
    if (!result) return;
    deleteCalendarEvent(button.dataset.deleteNote);
    render();
  }));
  document.querySelectorAll('[data-calendar-task-toggle]').forEach((button) => button.addEventListener('click', () => {
    toggleCalendarTask(button.dataset.calendarTaskToggle, button.dataset.calendarTaskDate);
    render();
  }));
  document.querySelectorAll('[data-add-subtask]').forEach((button) => button.addEventListener('click', async () => {
    const result = await openAppDialog({ title: 'Нова підзадача', fields: [{ key: 'title', label: 'Назва підзадачі', required: true }], confirmText: 'Додати' });
    if (!result) return;
    addCalendarSubtask(button.dataset.addSubtask, result.title, button.dataset.addSubtaskDate);
    render();
  }));
  document.querySelectorAll('[data-calendar-subtask-toggle]').forEach((button) => button.addEventListener('click', () => {
    toggleCalendarSubtask(button.dataset.calendarSubtaskToggle, button.dataset.calendarSubtaskId, button.dataset.calendarSubtaskDate);
    render();
  }));
  document.querySelectorAll('[data-delete-subtask]').forEach((button) => button.addEventListener('click', async () => {
    const result = await openAppDialog({ title: 'Видалити підзадачу', message: 'Підзадачу буде видалено.', confirmText: 'Видалити', danger: true });
    if (!result) return;
    deleteCalendarSubtask(button.dataset.deleteSubtask, button.dataset.deleteSubtaskId);
    render();
  }));
  const moveTaskDate = (days) => {
    const date = new Date(`${uiState.calendarTaskDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    if (date.getFullYear() !== getSettings().workingYear) return;
    uiState.calendarTaskDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    render();
  };
  document.querySelector('[data-calendar-task-prev]')?.addEventListener('click', () => moveTaskDate(-1));
  document.querySelector('[data-calendar-task-next]')?.addEventListener('click', () => moveTaskDate(1));
  document.querySelector('[data-calendar-task-date-picker]')?.addEventListener('change', (event) => {
    if (!event.target.value || Number(event.target.value.slice(0, 4)) !== getSettings().workingYear) return;
    uiState.calendarTaskDate = event.target.value;
    render();
  });
  document.querySelectorAll('[data-hr-section]').forEach((button) => button.addEventListener('click', () => { uiState.hrSection = button.dataset.hrSection; render(); }));
  document.querySelector('[data-add-employee]')?.addEventListener('click', () => openEmployeeCard());
  document.querySelectorAll('[data-open-employee]').forEach((button) => button.addEventListener('click', () => openEmployeeCard(button.dataset.openEmployee)));
  document.querySelector('[data-hr-doc-prev]')?.addEventListener('click', () => { if (uiState.hrDocumentsMonth > 1) { uiState.hrDocumentsMonth -= 1; render(); } });
  document.querySelector('[data-hr-doc-next]')?.addEventListener('click', () => { if (uiState.hrDocumentsMonth < 12) { uiState.hrDocumentsMonth += 1; render(); } });
  document.querySelectorAll('[data-hr-document]').forEach((button) => button.addEventListener('click', () => {
    const next = button.textContent.trim() === 'Надіслано' ? 'Не надіслано' : 'Надіслано';
    setHrMonthlyDocumentStatus(button.dataset.hrDocument, button.dataset.hrPeriod, button.dataset.hrField, next);
    button.textContent = next;
    button.classList.toggle('sent', next === 'Надіслано');
    button.classList.toggle('pending', next !== 'Надіслано');
    button.setAttribute('aria-pressed', String(next === 'Надіслано'));
  }));
  document.querySelector('[data-payroll-prev]')?.addEventListener('click', () => { if (uiState.payrollMonth > 1) { uiState.payrollMonth -= 1; render(); } });
  document.querySelector('[data-payroll-next]')?.addEventListener('click', () => { if (uiState.payrollMonth < 12) { uiState.payrollMonth += 1; render(); } });
  document.querySelector('[data-add-payroll-client]')?.addEventListener('click', async () => {
    const clients = getVisibleClients().filter((client) => (client.employees || []).length);
    const period = `${getSettings().workingYear}-${String(uiState.payrollMonth).padStart(2, '0')}`;
    const paymentTypes = payrollPaymentTypes(period);
    const result = await openAppDialog({ title: 'Додати виплату зарплати', fields: [{ key: 'client', label: 'ФОП', required: true, options: clients.map((client) => client.name) }, { key: 'paymentType', label: 'Тип виплати', type: 'select', required: true, value: paymentTypes[0], options: paymentTypes }, { key: 'paymentDate', label: 'Дата виплати', type: 'date', value: payrollDateForPaymentType(getSettings(), period, paymentTypes[0]), required: false }], confirmText: 'Додати' });
    if (!result) return;
    const client = clients.find((item) => item.name === result.client);
    if (!client) { showToast('Оберіть ФОП зі списку.', 'error'); return; }
    const added = addPayrollForClient(client.id, period, result.paymentType, result.paymentDate);
    showToast(added ? `Додано працівників: ${added}.` : 'Усі працівники цього ФОП уже є у вибраній виплаті.', added ? 'success' : 'warn');
    render();
  });
  document.querySelector('[data-add-payroll-employee]')?.addEventListener('click', async () => {
    const choices = getVisibleClients().flatMap((client) => (client.employees || []).map((employee) => ({ client, employee, label: `${client.name} — ${employee.name}` })));
    const period = `${getSettings().workingYear}-${String(uiState.payrollMonth).padStart(2, '0')}`;
    const paymentTypes = payrollPaymentTypes(period);
    const result = await openAppDialog({ title: 'Додати працівника до виплати', fields: [{ key: 'employee', label: 'ФОП і працівник', required: true, options: choices.map((choice) => choice.label) }, { key: 'paymentType', label: 'Тип виплати', type: 'select', required: true, value: paymentTypes[0], options: paymentTypes }, { key: 'paymentDate', label: 'Дата виплати', type: 'date', value: payrollDateForPaymentType(getSettings(), period, paymentTypes[0]), required: false }], confirmText: 'Додати' });
    if (!result) return;
    const choice = choices.find((item) => item.label === result.employee);
    if (!choice) { showToast('Оберіть працівника зі списку.', 'error'); return; }
    const added = addPayrollEmployee(choice.client.id, choice.employee.id, period, result.paymentType, result.paymentDate);
    showToast(added ? 'Рядок працівника додано.' : 'Цей працівник уже є у вибраній виплаті.', added ? 'success' : 'warn');
    render();
  });
  document.querySelectorAll('[data-delete-payroll]').forEach((button) => button.addEventListener('click', async () => {
    const amount = button.dataset.payrollAmount ? `\nСума виплати: ${button.dataset.payrollAmount} грн.` : '';
    const result = await openAppDialog({
      title: 'Видалити зарплатний рядок',
      message: `${button.dataset.payrollEmployee || 'Працівник'}\n${button.dataset.payrollType || 'Виплата'}${amount}\n\nРядок буде видалено з обліку.`,
      confirmText: 'Видалити',
      danger: true,
    });
    if (!result) return;
    deletePayrollRecord(button.dataset.deletePayroll);
    render();
  }));
  const payrollDateToIso = (value) => {
    const parts = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!parts) return null;
    const iso = `${parts[3]}-${parts[2]}-${parts[1]}`;
    const parsed = new Date(`${iso}T00:00:00`);
    return parsed.getFullYear() === Number(parts[3]) && parsed.getMonth() + 1 === Number(parts[2]) && parsed.getDate() === Number(parts[1]) ? iso : null;
  };
  const invalidAmountMessage = 'Вкажіть невід’ємну суму в допустимому числовому форматі.';
  const savePayrollDate = (field, iso) => { setPayrollField(field.dataset.payrollId, 'paymentDate', iso); };
  document.querySelectorAll('.payroll-date-field').forEach((field) => field.addEventListener('input', () => {
    const digitPosition = field.value.slice(0, field.selectionStart || 0).replace(/\D/g, '').length;
    const digits = field.value.replace(/\D/g, '').slice(0, 8);
    const formatted = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.');
    field.value = formatted;
    const cursor = digitPosition <= 2 ? digitPosition : digitPosition <= 4 ? digitPosition + 1 : digitPosition + 2;
    field.setSelectionRange(cursor, cursor);
    if (digits.length === 8) {
      const iso = payrollDateToIso(formatted);
      if (iso) savePayrollDate(field, iso);
    }
  }));
  document.querySelectorAll('[data-payroll-picker]').forEach((button) => button.addEventListener('click', () => {
    const nativeField = document.querySelector(`[data-payroll-native-date="${button.dataset.payrollPicker}"]`);
    if (!nativeField) return;
    if (typeof nativeField.showPicker === 'function') nativeField.showPicker();
    else nativeField.click();
  }));
  document.querySelectorAll('[data-payroll-native-date]').forEach((field) => field.addEventListener('change', () => savePayrollDate(field, field.value)));
  document.querySelectorAll('.payroll-field').forEach((field) => field.addEventListener('change', () => {
    let value = field.value;
    if (field.dataset.payrollField === 'paymentDate') {
      const iso = value ? payrollDateToIso(value) : '';
      if (value && !iso) { showToast('Вкажіть дату у форматі дд.мм.рррр.', 'error'); return; }
      value = iso;
    }
    if (!setPayrollField(field.dataset.payrollId, field.dataset.payrollField, value)) {
      showToast(invalidAmountMessage, 'error');
    }
  }));
  document.querySelectorAll('[data-payroll-type-id]').forEach((field) => field.addEventListener('change', () => {
    if (!setPayrollPaymentType(field.dataset.payrollTypeId, field.value)) showToast('Не вдалося змінити тип: у цій виплаті вже є такий працівник з вибраним типом.', 'error');
    render();
  }));
  document.querySelectorAll('[data-move-payroll-client]').forEach((button) => button.addEventListener('click', () => {
    if (movePayrollClientInBatch(button.dataset.movePayrollClient, Number(button.dataset.moveDirection))) render();
  }));
  document.querySelectorAll('[data-activities-section]').forEach((button) => button.addEventListener('click', () => { uiState.activitiesSection = button.dataset.activitiesSection; render(); }));
  document.querySelector('#auditSearch')?.addEventListener('input', (event) => {
    const caret = event.target.selectionStart;
    uiState.auditSearch = event.target.value;
    render();
    requestAnimationFrame(() => {
      const field = document.querySelector('#auditSearch');
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  });
  document.querySelector('#auditStatus')?.addEventListener('change', (event) => { uiState.auditStatus = event.target.value; render(); });
  document.querySelector('#auditSection')?.addEventListener('change', (event) => { uiState.auditSection = event.target.value; render(); });
  document.querySelector('#auditClient')?.addEventListener('change', (event) => { uiState.auditClient = event.target.value; render(); });
  document.querySelector('#auditActor')?.addEventListener('change', (event) => { uiState.auditActor = event.target.value; render(); });
  document.querySelector('#auditDate')?.addEventListener('change', (event) => { uiState.auditDate = event.target.value; render(); });
  document.querySelector('[data-audit-rollback]')?.addEventListener('click', async () => {
    if (!canRollbackChanges()) { showToast('Відкат змін доступний лише адміністратору.', 'error'); return; }
    const now = new Date();
    const localValue = localDateTimeValue(now);
    const minimumValue = localDateTimeValue(rollbackRetentionStart());
    const result = await openAppDialog({
      title: 'Відкат змін',
      message: 'Доступний лише відкат за останні 7 днів. Буде відновлено стан перед першою зміною після вибраного моменту. Записи журналу не зникнуть: їх буде позначено скасованими.',
      fields: [{ key: 'cutoff', label: 'Скасувати зміни після дати й часу', type: 'datetime-local', value: localValue, min: minimumValue, max: localValue, required: true }],
      confirmText: 'Виконати відкат',
      danger: true,
    });
    if (!result) return;
    const cutoff = new Date(result.cutoff).toISOString();
    if (Number.isNaN(new Date(cutoff).getTime())) { showToast('Вкажіть коректну дату й час.', 'error'); return; }
    const count = rollbackChangesAfter(cutoff);
    showToast(count ? `Скасовано операцій: ${count}.` : 'Після цього моменту активних змін немає.', count ? 'success' : 'info');
    render();
  });
  document.querySelector('#activitiesSearch')?.addEventListener('input', (event) => {
    const caret = event.target.selectionStart;
    uiState.activitiesSearch = event.target.value;
    render();
    requestAnimationFrame(() => {
      const field = document.querySelector('#activitiesSearch');
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  });
  document.querySelector('[data-add-hr-order]')?.addEventListener('click', async () => {
    const clients = getVisibleClients();
    const choice = await openAppDialog({ title: 'Новий кадровий документ', message: 'Спочатку оберіть ФОП-роботодавця.', fields: [{ key: 'client', label: 'ФОП', type: 'select', required: true, options: clients.map((client) => client.name) }], confirmText: 'Далі' });
    const client = clients.find((item) => item.name === choice?.client);
    if (!client) return;
    const employeeNames = (client.employees || []).map((employee) => employee.name).filter(Boolean);
    const result = await openAppDialog({ title: 'Новий кадровий документ', message: `ФОП: ${client.name}`, fields: [{ key: 'number', label: 'Номер документа', required: true }, { key: 'date', label: 'Дата документа', type: 'date', value: todayIso(), required: true }, { key: 'subject', label: 'Суть документа', required: true }, { key: 'employeeName', label: 'ПІБ працівника (необов’язково)', options: employeeNames }, { key: 'effectiveDate', label: 'Дата початку дії', type: 'date', value: todayIso(), required: true }, { key: 'deliveryStatus', label: 'Статус надсилання', type: 'select', value: 'Не надіслано', required: true, options: ['Не надіслано', 'Надіслано'] }], confirmText: 'Зберегти' });
    if (!result) return;
    const period = `${getSettings().workingYear}-${String(uiState.hrDocumentsMonth || 1).padStart(2, '0')}`;
    const saved = saveHrOrder({ ...result, clientId: client.id, period });
    if (!saved) { showToast('Документ із таким номером уже є для цього ФОП або містить некоректні реквізити.', 'warn'); return; }
    render();
  });
  document.querySelectorAll('[data-edit-hr-order]').forEach((button) => button.addEventListener('click', async () => {
    const order = getHrOrders().find((item) => item.id === button.dataset.editHrOrder);
    if (!order) return;
    const clients = getVisibleClients();
    const employeeNames = clients.flatMap((client) => (client.employees || []).map((employee) => employee.name)).filter(Boolean);
    const result = await openAppDialog({ title: 'Редагувати кадровий документ', fields: [{ key: 'client', label: 'ФОП', required: true, value: getClientById(order.clientId)?.name || '', options: clients.map((client) => client.name) }, { key: 'number', label: 'Номер документа', required: true, value: order.number }, { key: 'date', label: 'Дата документа', type: 'date', value: order.date, required: true }, { key: 'subject', label: 'Суть документа', required: true, value: order.subject }, { key: 'employeeName', label: 'ПІБ працівника (необов’язково)', value: order.employeeName || '', options: employeeNames }, { key: 'effectiveDate', label: 'Дата початку дії', type: 'date', value: order.effectiveDate, required: true }, { key: 'deliveryStatus', label: 'Статус надсилання', value: order.deliveryStatus || 'Не надіслано', required: true, options: ['Не надіслано', 'Надіслано'] }], confirmText: 'Зберегти' });
    if (!result) return;
    const clientId = clients.find((client) => client.name === result.client)?.id;
    if (!clientId || !saveHrOrder({ ...order, ...result, clientId }, order.id)) { showToast('Не вдалося зберегти документ. Перевірте реквізити та номер.', 'error'); return; }
    render();
  }));
  document.querySelectorAll('[data-delete-hr-order]').forEach((button) => button.addEventListener('click', async () => {
    const result = await openAppDialog({ title: 'Видалити наказ', message: 'Наказ буде видалено з кадрового реєстру.', confirmText: 'Видалити', danger: true });
    if (!result) return;
    deleteHrOrder(button.dataset.deleteHrOrder); render();
  }));
  document.querySelectorAll('[data-toggle-order-delivery]').forEach((button) => button.addEventListener('click', () => {
    const order = getHrOrders().find((item) => item.id === button.dataset.toggleOrderDelivery);
    if (!order) return;
    saveHrOrder({ ...order, deliveryStatus: order.deliveryStatus === 'Надіслано' ? 'Не надіслано' : 'Надіслано' }, order.id);
    render();
  }));
  // --- Картка клієнта ---
  document.querySelectorAll('[data-open-card]').forEach((button) => {
    button.onclick = () => openClientCard(button.dataset.openCard);
  });
  document.querySelector('[data-add-client]')?.addEventListener('click', () => openClientCard(null));

  // --- Перетягування рядків (Картки клієнтів) ---
  const clientRows = [...document.querySelectorAll('[data-client-row]')];
  document.querySelectorAll('[data-drag-handle]').forEach((handle) => {
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const row = handle.closest('[data-client-row]');
      const index = clientRows.indexOf(row);
      const target = clientRows[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!row?.dataset.rowId || !target?.dataset.rowId) return;
      event.preventDefault();
      if (!reorderClients(row.dataset.rowId, target.dataset.rowId)) return;
      const movedId = row.dataset.rowId;
      render();
      requestAnimationFrame(() => [...document.querySelectorAll('[data-client-row]')]
        .find((item) => item.dataset.rowId === movedId)?.querySelector('[data-drag-handle]')?.focus());
    });
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const row = handle.closest('[data-client-row]');
      const dragSourceId = row?.dataset.rowId;
      if (!dragSourceId) return;
      handle.setPointerCapture?.(event.pointerId);
      row.classList.add('dragging');
      let targetRow = null;
      const rowAtPointer = (pointerEvent) => document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest('[data-client-row]');
      const move = (pointerEvent) => {
        const nextTarget = rowAtPointer(pointerEvent);
        clientRows.forEach((item) => item.classList.remove('drag-over'));
        targetRow = nextTarget && nextTarget !== row ? nextTarget : null;
        targetRow?.classList.add('drag-over');
      };
      const finish = () => {
        clientRows.forEach((item) => item.classList.remove('dragging', 'drag-over'));
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        if (targetRow?.dataset.rowId && targetRow.dataset.rowId !== dragSourceId) {
          reorderClients(dragSourceId, targetRow.dataset.rowId);
          render();
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });
  });

  // --- Огляд: клік по зауваженню переносить у відповідний розділ ---
  document.querySelectorAll('[data-alert-section]').forEach((button) => button.onclick = () => {
    const section = button.dataset.alertSection;
    if (section === 'taxes') { uiState.taxGroup = button.dataset.alertGroup; uiState.taxPeriod = button.dataset.alertPeriod; }
    if (section === 'reports') { uiState.reportGroup = button.dataset.alertGroup; uiState.reportPeriod = button.dataset.alertPeriod; }
    if (section === 'combinedReports') uiState.combinedReportPeriod = button.dataset.alertPeriod;
    if (section === 'incomes') uiState.incomeGroup = button.dataset.alertGroup;
    uiState.pendingHighlightClientId = button.dataset.alertClient;
    setView(section);
  });

  // --- Податки ---
  document.querySelectorAll('[data-tax-group]').forEach((b) => b.onclick = () => { uiState.taxGroup = b.dataset.taxGroup; uiState.taxPeriod = null; render(); });
  document.querySelectorAll('[data-tax-period]').forEach((b) => b.onclick = () => { uiState.taxPeriod = b.dataset.taxPeriod; render(); });
  document.querySelectorAll('.tax-field').forEach((field) => field.addEventListener('change', () => {
    const record = setTaxField(field.dataset.client, field.dataset.realGroup, uiState.taxPeriod, field.dataset.tax, field.dataset.field, field.value);
    if (!record) {
      showToast('Перевірте дату: сплата не може передувати набору в банку.', 'error');
      return;
    }
    const row = field.closest('tr');
    const deadline = getEffectiveTaxDeadline(field.dataset.realGroup, field.dataset.tax, uiState.taxPeriod, record);
    row?.querySelector('.tax-days')?.replaceChildren();
    const days = row?.querySelector('.tax-days'); if (days) days.innerHTML = record.exemption ? '-' : daysUntilLabel(deadline, record);
    const status = row?.querySelector('.tax-status'); if (status) status.innerHTML = statusPillHtml(record, deadline);
    if (field.dataset.field === 'exemption') {
      row?.classList.toggle('exempt-row', Boolean(field.value));
      const rows = [...document.querySelectorAll(`.tax-table tr[data-row-id="${CSS.escape(field.dataset.client)}"]`)];
      const fullyExempt = rows.length === 3 && rows.every((item) => Boolean(item.querySelector('[data-field="exemption"]')?.value));
      rows[0]?.querySelector('.fop-name-cell')?.classList.toggle('fop-fully-exempt', fullyExempt);
      rows.forEach((item) => item.classList.toggle('fop-all-exempt', fullyExempt && item.classList.contains('exempt-row')));
    }
  }));
  $('[data-tax-auto-ok]')?.addEventListener('click', async () => {
    const clients = getVisibleClients();
    const result = await openAppDialog({
      title: 'АвтоОК — податки', message: 'Оберіть ФОП. У всіх завершених періодах поточної групи будуть заповнені лише порожні поля «Набрано в банку» та «Дата сплати» — 01 число відповідного періоду.',
      fields: [{ key: 'clients', label: 'ФОП', type: 'checkboxes', options: clients.map((client) => ({ value: client.id, label: client.name, checked: true })) }], confirmText: 'Заповнити', cancelText: 'Закрити',
    });
    if (!result) return;
    const selected = result.clients || [];
    const selectedClients = clients.filter((client) => selected.includes(client.id));
    const changed = autoCompleteTaxPeriod(selectedClients.map((client) => client.id), uiState.taxGroup, TAX_TYPES.map((tax) => tax.key));
    showToast(changed ? `Заповнено ${changed} порожніх дат для ${selectedClients.length} ФОП.` : selectedClients.length ? 'У завершених періодах немає порожніх дат для заповнення.' : 'ФОП не обрано.', changed ? 'success' : 'info');
    render();
  });
  $('[data-copy-previous-period]')?.addEventListener('click', () => {
    const periods = taxPeriodsFor(uiState.taxGroup === '3' ? '3' : '1', getSettings().workingYear);
    const fromPeriod = previousPeriodKey(periods, uiState.taxPeriod);
    if (!fromPeriod) return;
    const clients = uiState.taxGroup === '3'
      ? getVisibleClients().filter((c) => String(c.group) === '3')
      : getVisibleClients().filter((c) => ['1', '2'].includes(String(c.group)));
    const clientIds = clients.map((c) => c.id);
    const realGroups = clients.map((c) => String(c.group));
    const filled = copyTaxPeriodForward(clientIds, realGroups, fromPeriod, uiState.taxPeriod, TAX_TYPES.map((t) => t.key));
    showToast(filled ? `Скопійовано ${filled} значень із попереднього періоду.` : 'Немає порожніх полів для копіювання.', filled ? 'success' : 'info');
    render();
  });

  // --- Декларації та об’єднані звіти ---
  document.querySelectorAll('[data-report-group]').forEach((b) => b.onclick = () => { uiState.reportGroup = b.dataset.reportGroup; uiState.reportPeriod = null; render(); });
  document.querySelectorAll('[data-report-period]').forEach((b) => b.onclick = () => { uiState.reportPeriod = b.dataset.reportPeriod; render(); });
  document.querySelectorAll('.report-field').forEach((field) => field.addEventListener('change', () => {
    const record = setReportField(field.dataset.client, field.dataset.realGroup, uiState.reportPeriod, field.dataset.field, field.value);
    if (!record) {
      showToast('Вкажіть коректне значення звітності.', 'error');
      return;
    }
    const row = field.closest('tr'); const deadline = getEffectiveReportDeadline(field.dataset.realGroup, uiState.reportPeriod, record);
    const days = row?.querySelector('.report-days'); if (days) days.innerHTML = reportDaysUntilLabel(deadline, record);
    const status = row?.querySelector('.report-status'); if (status) status.innerHTML = reportStatusPillHtml(record, deadline);
  }));
  document.querySelectorAll('[data-combined-report-period]').forEach((button) => button.addEventListener('click', () => { uiState.combinedReportPeriod = button.dataset.combinedReportPeriod; render(); }));
  document.querySelectorAll('.combined-report-field').forEach((field) => field.addEventListener('change', () => {
    const record = setCombinedReportField(field.dataset.client, uiState.combinedReportPeriod, field.dataset.field, field.value);
    if (!record) { showToast('Вкажіть коректне значення звітності.', 'error'); return; }
    const row = field.closest('tr'); const deadline = getEffectiveCombinedReportDeadline(uiState.combinedReportPeriod, record);
    const days = row?.querySelector('.report-days'); if (days) days.innerHTML = reportDaysUntilLabel(deadline, record);
    const status = row?.querySelector('.report-status'); if (status) status.innerHTML = reportStatusPillHtml(record, deadline);
  }));

  // --- Доходи ---
  document.querySelectorAll('[data-income-group]').forEach((b) => b.onclick = () => { uiState.incomeGroup = b.dataset.incomeGroup; render(); });
  document.querySelectorAll('.income-value').forEach((field) => field.addEventListener('change', () => {
    if (!setIncomeValue(field.dataset.client, field.dataset.month, field.value)) showToast(invalidAmountMessage, 'error');
  }));
  $('[data-import-incomes]')?.addEventListener('click', () => $('#incomeImportFile')?.click());
  $('#incomeImportFile')?.addEventListener('change', async (event) => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try {
      const rows = await readSpreadsheetMatrix(file);
      if (!rows.length) throw new Error('Файл порожній або не містить рядків даних.');
      const firstCell = String(rows[0]?.[0] || '').trim().toLocaleLowerCase('uk');
      const hasHeader = /піб|назва|фоп|name/.test(firstCell);
      const matrix = rows.slice(hasHeader ? 1 : 0).map((row) => ({ name: String(row[0] || '').trim(), values: row.slice(1, 13) })).filter((row) => row.name);
      const summary = importIncomeRows(matrix, getSettings().workingYear);
      const unknown = summary.unknown.length ? ` Не знайдено ФОП: ${summary.unknown.slice(0, 5).join(', ')}${summary.unknown.length > 5 ? '…' : ''}.` : '';
      const skipped = summary.skipped ? ` Некоректних сум пропущено: ${summary.skipped}.` : '';
      showToast(`Імпортовано значень доходу: ${summary.updated}.${skipped}${unknown}`, summary.updated ? 'success' : 'warn', 7000);
      render();
    } catch (error) { showToast(error.message || 'Не вдалося імпортувати доходи.', 'error', 7000); }
  });

  // --- Оплати ---
  document.querySelectorAll('[data-payments-quarter]').forEach((button) => button.addEventListener('click', () => { uiState.paymentsQuarter = Number(button.dataset.paymentsQuarter); render(); }));
  document.querySelectorAll('.month-value').forEach((field) => field.addEventListener('change', () => {
    if (!setMonthlyPaymentField(field.dataset.client, field.dataset.month, field.dataset.type, field.value)) showToast(invalidAmountMessage, 'error');
  }));
  document.querySelectorAll('[data-autofill-month]').forEach((button) => button.addEventListener('click', () => {
    const changed = autofillMonthlyCharges(button.dataset.autofillMonth);
    if (!changed) { showToast('У картках ФОП ще немає вартості обслуговування.', 'info'); return; }
    document.querySelectorAll(`.month-value[data-month="${CSS.escape(button.dataset.autofillMonth)}"][data-type="charged"]`).forEach((field) => {
      const client = getClientById(field.dataset.client);
      field.value = String(client?.serviceCost ?? '');
    });
    showToast(`Автоматично заповнено нарахування: ${changed}.`, 'success');
  }));

  // --- Налаштування ---
  $('#f_workingYear')?.addEventListener('change', () => {
    if (!setWorkingYear($('#f_workingYear').value)) showToast('Оберіть доступний робочий період.', 'error');
    render();
  });
  $('[data-create-working-year]')?.addEventListener('click', async () => {
    const years = getSettings().availableWorkingYears;
    const suggested = Math.max(...years) + 1;
    const result = await openAppDialog({ title: 'Новий робочий період', message: 'Створіть окремий календарний рік із порожніми дедлайнами.', fields: [{ key: 'year', label: 'Рік', type: 'number', value: suggested, required: true }], confirmText: 'Створити' });
    if (!result) return;
    if (!createWorkingYear(result.year)) { showToast('Не вдалося створити період: вкажіть новий рік від 2026 до 2100.', 'error'); return; }
    render();
  });
  $('[data-open-deleted]')?.addEventListener('click', () => {
    uiState.deletedSectionUnlocked = true;
    setView('deleted');
  });
  $('[data-download-backup]')?.addEventListener('click', () => {
    void downloadBackup().catch((error) => showToast(`Не вдалося створити резервну копію: ${error.message || error}`, 'error', 9000));
  });
  $('[data-restore-backup]')?.addEventListener('click', () => $('#backupRestoreFile')?.click());
  $('#backupRestoreFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      assertBackupFileSize(file);
      const parsed = JSON.parse(await file.text());
      let source = parsed;
      if (isEncryptedBackup(parsed)) {
        const password = await openAppDialog({
          title: 'Відкрити зашифровану копію',
          message: 'Введіть пароль, який було задано під час створення цієї резервної копії.',
          fields: [{ key: 'password', label: 'Пароль резервної копії', type: 'password', maxLength: MAX_PASSWORD_LENGTH, required: true }],
          confirmText: 'Відкрити',
        });
        if (!password) return;
        source = await decryptBackup(parsed, password.password);
      }
      const backup = source?.format === 'harmony-backup' ? source.database : source;
      validateBackupDatabase(backup);
      const createdAt = source?.format === 'harmony-backup' && source.createdAt
        ? new Date(source.createdAt).toLocaleString('uk-UA') : 'дата створення не вказана';
      const clientCount = Array.isArray(backup?.clients) ? backup.clients.length : 0;
      const legacyWarning = isEncryptedBackup(parsed) ? '' : ' Файл не зашифрований: після відновлення створіть нову захищену копію.';
      const result = await openAppDialog({
        title: 'Відновити резервну копію',
        message: `Копію створено: ${createdAt}. ФОП у копії: ${clientCount}. Поточні локальні дані буде замінено вмістом файлу. Розбіжності з хмарою буде винесено в окремі конфлікти.${legacyWarning} Введіть ВІДНОВИТИ для підтвердження.`,
        fields: [{ key: 'confirmation', label: 'Підтвердження', required: true }],
        confirmText: 'Відновити дані',
        danger: true,
      });
      if (!result || result.confirmation !== 'ВІДНОВИТИ') return;
      await replaceDatabase(backup);
      requestRestoreSync();
      render();
      showToast('Резервну копію відновлено. Спочатку буде перевірено розбіжності з хмарою.', 'success', 7000);
    } catch (error) {
      showToast(`Не вдалося відновити резервну копію: ${error.message || error}`, 'error', 9000);
    }
  });
  $('#f_minWage')?.addEventListener('change', () => {
    if (!setMinWage($('#f_minWage').value)) showToast('МЗП має бути додатним числом.', 'error');
    render();
  });
  document.querySelectorAll('.settings-field').forEach((field) => field.addEventListener('change', () => {
    let saved = false;
    if (field.dataset.scope === 'monthly') saved = setMonthlyTaxDeadline(field.dataset.period, field.value);
    else if (field.dataset.scope === 'quarterly') saved = setQuarterlyTaxDeadline(field.dataset.tax, field.dataset.period, field.value);
    else if (field.dataset.scope === 'report-annual') saved = setReportDeadline('annual', field.dataset.period, field.value);
    else if (field.dataset.scope === 'report-quarterly') saved = setReportDeadline('quarterly', field.dataset.period, field.value);
    else if (field.dataset.scope === 'report-combined') saved = setReportDeadline('combined', field.dataset.period, field.value);
    if (!saved) showToast('Вкажіть коректну дату дедлайну.', 'error');
  }));
  document.querySelectorAll('[data-dropdown-options]').forEach((field) => field.addEventListener('change', () => {
    const values = [...document.querySelectorAll(`[data-dropdown-options="${CSS.escape(field.dataset.dropdownOptions)}"]`)].map((item) => item.value).filter(Boolean).join('\n');
    if (!setDropdownOptions(field.dataset.dropdownOptions, values)) showToast('Не вдалося зберегти список.', 'error');
  }));
  document.querySelectorAll('[data-settings-section]').forEach((button) => button.addEventListener('click', async () => {
    uiState.settingsSection = button.dataset.settingsSection;
    render();
    if (uiState.settingsSection === 'users') {
      try { uiState.managedUsers = await listAuthenticationUsers(); }
      catch (error) { showToast(error.message || String(error), 'error'); }
    }
    if (uiState.settingsSection === 'conflicts') {
      try { uiState.syncConflicts = await getOpenSyncConflicts(); }
      catch (error) { showToast(error.message || String(error), 'error'); }
    }
    if (uiState.settingsSection === 'diagnostics' && uiState.currentUser?.role === 'administrator') {
      try {
        [uiState.syncLog, uiState.localDatabaseHealth] = await Promise.all([getRecentSyncLog(), checkLocalDatabase()]);
        uiState.localDatabaseIssues = getDatabaseRelationshipIssues();
      }
      catch (error) { showToast(error.message || String(error), 'error'); }
    }
    render();
  }));
  document.querySelector('[data-save-section-headings]')?.addEventListener('click', () => {
    const headings = Object.fromEntries([...document.querySelectorAll('[data-section-heading]')].reduce((entries, field) => {
      const key = field.dataset.sectionHeading;
      const item = entries.find(([entryKey]) => entryKey === key)?.[1] || {};
      item[field.dataset.headingPart] = field.value;
      if (!entries.some(([entryKey]) => entryKey === key)) entries.push([key, item]);
      return entries;
    }, []));
    if (!setSectionHeadings(headings)) { showToast('Заголовки може змінювати лише адміністратор.', 'error'); return; }
    showToast('Заголовки розділів збережено.', 'success');
    render();
  });
  $('[data-refresh-sync-log]')?.addEventListener('click', async () => {
    try { uiState.syncLog = await getRecentSyncLog(); render(); }
    catch (error) { showToast(error.message || String(error), 'error'); }
  });
  $('[data-check-local-db]')?.addEventListener('click', async () => {
    try {
      uiState.localDatabaseHealth = await checkLocalDatabase();
      uiState.localDatabaseIssues = getDatabaseRelationshipIssues();
      render();
      showToast(uiState.localDatabaseHealth.ok ? 'Цілісність локальної бази підтверджено.' : 'SQLite повідомила про проблему. Створіть резервну копію та зверніться до адміністратора.', uiState.localDatabaseHealth.ok ? 'success' : 'error', 9000);
    } catch (error) { showToast(`Не вдалося перевірити локальну базу: ${error.message || error}`, 'error', 9000); }
  });
  document.querySelectorAll('[data-resolve-sync-conflict]').forEach((button) => button.addEventListener('click', async () => {
    const resolution = button.dataset.resolution;
    if (!['local', 'remote'].includes(resolution)) return;
    try {
      const resolved = await resolveSyncConflict(button.dataset.resolveSyncConflict, resolution);
      if (!resolved) throw new Error('Конфлікт уже вирішено або не знайдено.');
      uiState.syncConflicts = await getOpenSyncConflicts();
      await refreshDatabaseFromSync();
      render();
      showToast(resolution === 'local' ? 'Залишено локальну версію. Її буде синхронізовано.' : 'Прийнято віддалену версію.', 'success');
    } catch (error) { showToast(error.message || String(error), 'error'); }
  }));
  $('[data-create-user]')?.addEventListener('click', async () => {
    const result = await openAppDialog({ title: 'Новий користувач', message: 'Використайте унікальний пароль або парольну фразу. Електронна пошта для входу не потрібна.', fields: [{ key: 'login', label: 'Логін', maxLength: 40, required: true }, { key: 'displayName', label: 'Ім’я', maxLength: 80, required: true }, { key: 'role', label: 'Роль', type: 'select', options: ['accountant', 'observer', 'administrator'], value: 'accountant', required: true }, { key: 'password', label: `Пароль (щонайменше ${MIN_PASSWORD_LENGTH} символів)`, type: 'password', minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH, autocomplete: 'new-password', required: true }, { key: 'passwordConfirmation', label: 'Повторіть пароль', type: 'password', minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH, autocomplete: 'new-password', required: true }], confirmText: 'Створити' });
    if (!result) return;
    const passwordError = passwordPolicyError(result.password, result.login);
    if (passwordError) { showToast(passwordError, 'error', 9000); return; }
    if (result.password !== result.passwordConfirmation) { showToast('Паролі не збігаються.', 'error'); return; }
    const { passwordConfirmation, ...payload } = result;
    try { await manageHarmonyUsers('create', payload); uiState.managedUsers = await listAuthenticationUsers(); render(); showToast('Користувача створено.', 'success'); }
    catch (error) { showToast(error.message || String(error), 'error', 8000); }
  });
  document.querySelectorAll('[data-manage-user]').forEach((button) => button.addEventListener('click', async () => {
    const user = uiState.managedUsers.find((item) => item.userId === button.dataset.manageUser);
    if (!user) return;
    const result = await openAppDialog({ title: user.bound ? 'Змінити користувача' : 'Прив’язати користувача', message: user.bound ? 'За потреби задайте новий пароль. Залиште обидва парольні поля порожніми, щоб не змінювати його.' : `Обліковий запис ${user.email || 'Supabase Auth'} буде прив’язано до логіна Harmony.`, fields: [{ key: 'login', label: 'Логін', value: user.login, maxLength: 40, required: true }, { key: 'displayName', label: 'Ім’я', value: user.displayName, maxLength: 80, required: true }, { key: 'role', label: 'Роль', type: 'select', options: ['accountant', 'observer', 'administrator'], value: user.role, required: true }, { key: 'password', label: 'Новий пароль', type: 'password', minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH, autocomplete: 'new-password' }, { key: 'passwordConfirmation', label: 'Повторіть новий пароль', type: 'password', minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH, autocomplete: 'new-password' }, { key: 'isActive', label: 'Статус', type: 'select', options: ['Активний', 'Вимкнений'], value: user.isActive ? 'Активний' : 'Вимкнений', required: true }], confirmText: 'Зберегти' });
    if (!result) return;
    if (result.password) {
      const passwordError = passwordPolicyError(result.password, result.login);
      if (passwordError) { showToast(passwordError, 'error', 9000); return; }
      if (result.password !== result.passwordConfirmation) { showToast('Паролі не збігаються.', 'error'); return; }
    } else if (result.passwordConfirmation) { showToast('Введіть новий пароль у першому полі.', 'error'); return; }
    const { passwordConfirmation, ...payload } = result;
    try {
      const action = user.bound ? 'update' : 'bind';
      await manageHarmonyUsers(action, { ...payload, userId: user.userId, isActive: result.isActive === 'Активний' });
      uiState.managedUsers = await listAuthenticationUsers(); render(); showToast('Дані користувача збережено.', 'success');
    } catch (error) { showToast(error.message || String(error), 'error', 8000); }
  }));
  const previewAppearance = () => Object.fromEntries([...document.querySelectorAll('[data-appearance]')]
    .filter((field) => field.type !== 'radio' || field.checked)
    .map((field) => [field.dataset.appearance, field.value]));
  document.querySelectorAll('[data-appearance]').forEach((field) => field.addEventListener('change', () => applyAppearance(previewAppearance(), document.querySelector('#appearancePreview'))));
  document.querySelector('[data-save-appearance]')?.addEventListener('click', () => {
    const appearance = previewAppearance();
    Object.entries(appearance).forEach(([key, value]) => setAppearanceSetting(key, key === 'fieldColor' ? value : Number(value)));
    applyAppearance();
    showToast('Зовнішній вигляд збережено.', 'success');
  });
  let activityReferenceKind = '';
  document.querySelectorAll('[data-import-activity-reference]').forEach((button) => button.addEventListener('click', () => {
    activityReferenceKind = button.dataset.importActivityReference;
    $('#activityReferenceFile')?.click();
  }));
  $('#activityReferenceFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file || !activityReferenceKind) return;
    try {
      const source = await readSpreadsheetRows(file);
      const field = (row, names) => {
        const entry = Object.entries(row).find(([key]) => names.includes(String(key).trim().toLocaleLowerCase('uk-UA')));
        return String(entry?.[1] ?? '').trim();
      };
      const permission = (value) => {
        const normalized = String(value || '').trim().toLocaleLowerCase('uk-UA');
        if (['ні', 'не дозволено', 'заборонено', 'no', 'false', '0'].includes(normalized)) return 'ні';
        if (['так', 'дозволено', 'yes', 'true', '1'].includes(normalized)) return 'так';
        return normalized;
      };
      const rows = source.map((row) => [normalizeActivityCode(field(row, ['код', 'код квед', 'код nace'])), field(row, ['назва', 'найменування', 'назва квед', 'назва nace']), permission(field(row, ['1 група', 'група 1'])), permission(field(row, ['2 група', 'група 2'])), permission(field(row, ['3 група', 'група 3'])), field(row, ['примітка', 'обмеження'])]).filter((row) => row[0] && row[1]);
      if (!rows.length) throw new Error('Не знайдено рядків з обов’язковими колонками «Код» і «Назва».');
      if (!setActivityReference(activityReferenceKind, rows)) throw new Error('Не вдалося зберегти довідник.');
      applyActivityReferenceOverrides({ [activityReferenceKind]: rows });
      showToast(`Довідник ${activityReferenceKind === 'kved' ? 'КВЕД' : 'NACE'} оновлено: ${rows.length} записів.`, 'success');
      render();
    } catch (error) { showToast(error.message || String(error), 'error', 9000); }
    finally { event.target.value = ''; activityReferenceKind = ''; }
  });
  document.querySelector('[data-download-activity-template]')?.addEventListener('click', () => {
    let objectUrl = '';
    try {
      const csv = '\uFEFFКод;Назва;1 група;2 група;3 група;Примітка\r\n01.11;Вирощування зернових культур;так;так;так;\r\n';
      const link = document.createElement('a');
      objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.href = objectUrl;
      link.download = 'pryklad-dovidnyka-kved-nace.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('Приклад довідника КВЕД/NACE успішно завантажено.', 'success');
    } catch (error) {
      showToast(`Не вдалося завантажити приклад довідника: ${error.message || error}`, 'error', 9000);
    } finally {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  });

  // --- Неактивні ---
  document.querySelectorAll('[data-restore-client]').forEach((b) => b.onclick = () => {
    archiveClient(b.dataset.restoreClient, false);
    render();
  });
  document.querySelectorAll('[data-request-delete-client]').forEach((b) => b.onclick = async () => {
    const item = getClientById(b.dataset.requestDeleteClient);
    if (!item) return;
    const result = await openAppDialog({ title: 'Перенести до видалених', message: 'ФОП одразу буде перенесено до розділу «Видалені». Вкажіть причину, а потім введіть повний ПІБ вручну.', fields: [{ key: 'reason', label: 'Причина видалення', required: true }, { key: 'name', label: `Повний ПІБ: ${item.name}`, required: true, manualEntry: true }], confirmText: 'Перенести', danger: true });
    if (!result) return;
    if (result.name !== item.name) { showToast('ПІБ не збігається. Запит на видалення скасовано.', 'error'); return; }
    requestClientDeletion(item.id, result.reason);
    showToast('ФОП перенесено до «Видалених».', 'info');
    render();
  });
  document.querySelectorAll('[data-restore-deleted-client]').forEach((b) => b.onclick = () => {
    setClientLifecycle(b.dataset.restoreDeletedClient, 'active');
    render();
  });
  document.querySelectorAll('[data-purge-test-client]').forEach((b) => b.onclick = async () => {
    const item = getClientById(b.dataset.purgeTestClient);
    if (!item) return;
    const result = await openAppDialog({ title: 'Остаточне стирання', message: `Це безповоротно зітре тестовий ФОП «${item.name}» і всі пов'язані дані.`, fields: [{ key: 'confirmation', label: 'Введіть СТЕРТИ для підтвердження', required: true }], confirmText: 'Стерти назавжди', danger: true });
    if (!result || result.confirmation !== 'СТЕРТИ') return;
    await deleteClientPermanently(item.id);
    render();
  });

  // --- Картки клієнтів: експорт/імпорт Excel, кастомні колонки ---
  $('[data-export-clients]')?.addEventListener('click', async () => { try { await exportClientsToExcel(); showToast('Експорт успішно завершено.', 'success'); } catch (error) { showToast(`Не вдалося експортувати: ${error.message || error}`, 'error'); } });
  $('[data-dashboard-search]')?.addEventListener('input', (event) => {
    const caret = event.target.selectionStart;
    uiState.dashboardSearch = event.target.value;
    render();
    const field = $('[data-dashboard-search]');
    field?.focus();
    if (caret !== null) field?.setSelectionRange(caret, caret);
  });
  $('[data-clear-dashboard-filters]')?.addEventListener('click', () => {
    uiState.dashboardSearch = '';
    uiState.dashboardFilters = {};
    uiState.dashboardFilterOpen = null;
    render();
    $('[data-dashboard-search]')?.focus();
  });
  $('[data-dashboard-sort]')?.addEventListener('change', (event) => { uiState.dashboardSort = event.target.value; render(); });
  document.querySelectorAll('[data-dashboard-filter]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    uiState.dashboardFilterOpen = uiState.dashboardFilterOpen === button.dataset.dashboardFilter ? null : button.dataset.dashboardFilter;
    render();
  }));
  $('[data-close-dashboard-filter]')?.addEventListener('click', () => { uiState.dashboardFilterOpen = null; render(); });
  $('[data-filter-select-all]')?.addEventListener('change', (event) => {
    document.querySelectorAll('[data-filter-option]').forEach((field) => { field.checked = event.target.checked; });
  });
  $('[data-apply-dashboard-filter]')?.addEventListener('click', () => {
    const key = $('[data-dashboard-filter-menu]')?.dataset.filterKey;
    if (!key) return;
    const all = [...document.querySelectorAll('[data-filter-option]')];
    const selected = all.filter((field) => field.checked).map((field) => field.value);
    if (selected.length === all.length) delete uiState.dashboardFilters[key];
    else uiState.dashboardFilters[key] = selected;
    uiState.dashboardFilterOpen = null;
    render();
  });
  $('[data-import-clients]')?.addEventListener('click', () => $('#importFile')?.click());
  $('#importFile')?.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const summary = await importClientsFromFile(file);
      summary.warnings.forEach((w) => showToast(w, 'warn', 6000));
      showToast(`Імпорт завершено. Нових: ${summary.created}, оновлено: ${summary.updated}${summary.skipped ? `, пропущено: ${summary.skipped}` : ''}.`, 'success', 6000);
      render();
    } catch (error) {
      showToast(error.message, 'error', 8000);
    }
  });
  $('[data-add-column]')?.addEventListener('click', () => openColumnForm());
  document.querySelectorAll('[data-edit-column]').forEach((b) => b.onclick = () => openColumnForm(getCustomColumns().find((c) => c.id === b.dataset.editColumn)));
  document.querySelectorAll('[data-delete-column]').forEach((b) => b.onclick = async () => {
    const column = getCustomColumns().find((c) => c.id === b.dataset.deleteColumn);
    if (!column) return;
    const result = await openAppDialog({ title: 'Видалити колонку', message: `Колонка «${column.name}» і значення в картках ФОП будуть видалені.`, confirmText: 'Видалити', danger: true });
    if (!result) return;
    deleteCustomColumn(column.id);
    render();
  });
  document.querySelectorAll('.custom-cell').forEach((field) => field.addEventListener('change', () => {
    setCustomFieldValue(field.dataset.client, field.dataset.column, field.value.trim());
  }));
}

function wireGlobalControls() {
  $('#nav').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !TITLES[button.dataset.view]) return;
    setView(button.dataset.view);
  });

  let hPresses = [];
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const hasOpenWindow = Boolean(document.querySelector('dialog[open], .cc-overlay.open'));
      if (hasOpenWindow) {
        event.preventDefault();
        closeAppDialog();
        closeEmployeeCard();
        closeClientCard();
        if ($('#modal')?.open) closeModal();
      }
      return;
    }
    if (!uiState.currentUser || !db) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      if (undoLastAction()) { event.preventDefault(); render(); showToast('Останню дію скасовано.', 'info'); }
      return;
    }
      if (String(event.key || '').toLowerCase() !== 'h' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const now = Date.now();
    hPresses = hPresses.filter((time) => now - time < 2000);
    hPresses.push(now);
    if (hPresses.length < 5 || uiState.deletedSectionUnlocked) return;
    uiState.deletedSectionUnlocked = true;
    showToast('Розділ «Видалені» відкрито на цей сеанс.', 'info');
  });

  $('#quickNote').addEventListener('click', () => openNoteEditor());

  $('#authBtn').addEventListener('click', async () => {
    const email = await signedInEmail();
    const result = await openAppDialog({ title: 'Вихід із Harmony', message: `Вийти з облікового запису ${email || uiState.currentUser?.displayName || ''}?`, confirmText: 'Вийти', danger: true });
    if (!result) return;

    // Hide all private DOM synchronously. Credential and database cleanup then
    // runs behind the login gate, so even a slow SQLite close cannot leak data.
    setAuthenticatedUi(false);
    setAuthBusy(true);
    setAuthError('Завершення сеансу…');
    let authenticated = false;
    try {
      await signOut();
      authenticated = true;
    } catch (error) {
      console.warn('Не вдалося очистити локальну auth-сесію:', error);
    }
    try {
      await lockDatabase();
    } catch (error) {
      console.error('Не вдалося повністю закрити локальну базу під час виходу:', error);
    } finally {
      setAuthBusy(false);
      setAuthError(authenticated ? '' : 'Сеанс заблоковано. Перезапустіть Harmony перед наступним входом.');
    }
  });

  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setAuthError();
    setAuthBusy(true);
    let authenticated = false;
    try {
      await prepareDatabaseSwitch();
      await signIn($('#authLogin').value, $('#authPassword').value);
      authenticated = true;
      const profile = await getCurrentHarmonyUser();
      if (!profile) throw new Error('Для цього облікового запису не задано активний профіль Harmony. Зверніться до адміністратора.');
      uiState.currentUser = profile;
      showBootOverlay(true);
      await initDatabase(profile.workspaceId);
      setAccessRole(profile.role);
      purgeDeletedTestClients();
      setAuditActor(profile.displayName);
      setAccessRole(profile.role);
      setAuthButtonLabel(`Вийти (${profile.displayName})`);
      $('#userIdentity').textContent = profile.displayName;
      setAuthenticatedUi(true);
      setView('overview');
      requestSync();
      showToast('Вхід виконано. Запущено синхронізацію.', 'success');
      void checkForUpdate();
    } catch (error) {
      showBootOverlay(false);
      setAuthenticatedUi(false);
      await lockDatabase().catch(() => {});
      if (authenticated) await signOut().catch(() => {});
      setAuthError(error.message || String(error));
    } finally {
      setAuthBusy(false);
      showBootOverlay(false);
    }
  });

  $('#modalForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('#modalForm').reportValidity()) return;
    if (handleModalSubmit()) { closeModal(); render(); }
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) closeModal(); });

  document.addEventListener('harmony:changed', () => { if (uiState.currentUser && db) render(); });
  document.addEventListener('harmony:access-denied', () => { if (uiState.currentUser && db) { showToast('У вас є доступ лише до перегляду.', 'warn'); render(); } });
  window.addEventListener('harmony:sync-conflict', (event) => {
    if (!uiState.currentUser || !db) return;
    const count = Number(event.detail?.conflicts?.length || 1);
    showToast(`Виявлено конфлікт синхронізації${count > 1 ? ` (${count})` : ''}. Локальні зміни збережено; віддалені дані не перезаписано.`, 'warn', 9000);
  });
  window.addEventListener('harmony:remote-sync', () => {
    if (!uiState.currentUser || !db) return;
    scheduleRemoteUiRefresh();
  });

  bindTopScrollbarResize();
}

/** Check installed desktop builds only; Vite in a browser never attempts an update. */
async function checkForUpdate() {
  if (!window.__TAURI_INTERNALS__ || !uiState.currentUser || !db) return;
  try {
    const update = await check();
    if (!update || !uiState.currentUser || !db) return;
    const result = await openAppDialog({
      title: `Доступне оновлення ${update.version}`,
      message: update.body || 'Доступна нова версія Harmony. Програма завантажить і встановить її, після чого перезапуститься.',
      confirmText: 'Оновити зараз',
    });
    if (!result) return;
    showToast('Завантаження оновлення…', 'info', 0);
    await update.downloadAndInstall();
    await invoke('restart_app');
  } catch (error) {
    // Updates are optional: an unavailable release must never block accounting work.
    console.info('Перевірка оновлень недоступна:', error);
  }
}

async function boot() {
  setAuthenticatedUi(false);
  wireGlobalControls();
  try {
    const email = await signedInEmail();
    if (!email) return;
    showBootOverlay(true);
    const profile = await getCurrentHarmonyUser();
    if (!profile) {
      await signOut().catch(() => {});
      setAuthError('Обліковий запис не має активного профілю Harmony.');
      return;
    }
    uiState.currentUser = profile;
    await initDatabase(profile.workspaceId);
    setAccessRole(profile.role);
    purgeDeletedTestClients();
    try { uiState.localStorageProtection = await getLocalStorageProtection(); }
    catch (error) { uiState.localStorageProtection = { enabled: false, detail: error.message || String(error) }; }
    try { await loadActivityReference(); }
    catch (error) { console.warn('Не вдалося завантажити вбудований довідник видів діяльності:', error); }
    applyActivityReferenceOverrides(getSettings().activityReferences || {});
    const actor = profile.displayName || email;
    setAuditActor(actor);
    setAccessRole(profile.role);
    setAuthButtonLabel(`Вийти (${actor})`);
    $('#userIdentity').textContent = actor;
    setAuthenticatedUi(true);
    setView('overview');
    if (!uiState.localStorageProtection?.enabled) {
      const detail = uiState.localStorageProtection?.detail ? ` Причина: ${uiState.localStorageProtection.detail}` : '';
      showToast(`Локальна база не захищена EFS.${detail} Стан шифрування можна переглянути у «Налаштування → Діагностика».`, 'warn', 9000);
    }
    void checkForUpdate();
  } catch (error) {
    console.error('Помилка запуску застосунку:', error);
    showBootOverlay(false);
    setAuthenticatedUi(false);
    await lockDatabase().catch(() => {});
    await signOut().catch(() => {});
    setAuthError(`Не вдалося відкрити захищений робочий простір: ${error.message || error}`);
  } finally {
    showBootOverlay(false);
  }
}

boot();
