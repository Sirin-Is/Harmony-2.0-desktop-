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
  db, initDatabase, refreshDatabaseFromSync, undoLastAction, setAuditActor, setAccessRole, getClientById, deleteClientPermanently, archiveClient, requestClientDeletion, setClientLifecycle, reorderClients, setCustomFieldValue, replaceDatabase,
  setMonthlyPaymentField, setTaxField, setReportField, setIncomeValue,
  setWorkingYear, createWorkingYear, setMinWage, setMonthlyTaxDeadline, setQuarterlyTaxDeadline, setReportDeadline, setAppearanceSetting, getSettings,
  deleteCustomColumn, getCustomColumns,
  copyTaxPeriodForward, getVisibleClients, saveCalendarEvent, deleteCalendarEvent, toggleCalendarTask, addCalendarSubtask, toggleCalendarSubtask, deleteCalendarSubtask, rollbackChangesAfter, getCalendarEvents, getHrOrders, saveHrOrder, deleteHrOrder, setHrMonthlyDocumentStatus, addPayrollForClient, addPayrollEmployee, deletePayrollRecord, setPayrollField,
} from './state.js';
import { TAX_TYPES, previousPeriodKey, taxPeriodsFor } from './tax-model.ts';
import { setupTopScrollbars, bindTopScrollbarResize } from './render/layout.js';
import { renderOverview } from './render/overview.js';
import { renderDashboard } from './render/dashboard.js';
import { renderPayments, positionPaymentsTable } from './render/payments.js';
import { renderTaxes } from './render/taxes.js';
import { renderIncomes } from './render/incomes.js';
import { renderReports } from './render/reports.js';
import { renderCalendar } from './render/calendar.js';
import { renderActivities } from './render/activities.js';
import { renderHR } from './render/hr.js';
import { renderDesignTest } from './render/design-test.js';
import { renderAudit } from './render/audit.js';
import { loadActivityReference } from './data/activity-reference.js';
import { renderInactive } from './render/inactive.js';
import { renderDeleted } from './render/deleted.js';
import { renderSettings } from './render/settings.js';
import { openColumnForm, handleModalSubmit, closeModal } from './modals.js';
import { openClientCard } from './client-card-ui.js';
import { exportClientsToExcel, importClientsFromFile } from './import-export.js';
import { showToast } from './toast.js';
import { openAppDialog } from './app-dialog.js';
import { enhanceDateInputs } from './date-input.js';
import { validateKved, openKvedResults } from './kved-validation.js';
import { signIn, signOut, signedInEmail } from './auth/session';
import { getCurrentHarmonyUser, listAuthenticationUsers, manageHarmonyUsers } from './auth/users';
import { getOpenSyncConflicts, requestSync, resolveSyncConflict } from './storage.js';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const TITLES = {
  overview: ['Огляд', 'Зведення зауважень по розділах'],
  dashboard: ['Картки клієнтів', 'Картки клієнтів ФОП'],
  payments: ['Оплати', 'Оплати бухгалтерських послуг'],
  taxes: ['Податки', 'Сплата податків по групах ЄП'],
  incomes: ['Доходи', 'Облік доходів і залишку ліміту'],
  reports: ['Звітність', 'Подання звітів по групах ЄП'],
  calendar: ['Календар', 'Задачі та автоматичні дедлайни'],
  activities: ['Види діяльності', 'Довідники КВЕД-2010 та NACE 2.1-UA'],
  hr: ['Кадри', 'Наймані працівники та кадрові документи'],
  'design-test': ['Тест дизайну', 'Варіанти полів вибору дати'],
  audit: ['Журнал подій', 'Історія змін і відкат'],
  inactive: ['Неактивні', 'Приховані ФОП'],
  deleted: ['Видалені', 'Кошик — відновлення ФОП'],
  settings: ['Налаштування', 'МЗП і дедлайни сплати податків'],
};

const VIEWS = {
  overview: renderOverview,
  dashboard: renderDashboard,
  payments: renderPayments,
  taxes: renderTaxes,
  incomes: renderIncomes,
  reports: renderReports,
  calendar: renderCalendar,
  activities: renderActivities,
  hr: renderHR,
  'design-test': renderDesignTest,
  audit: renderAudit,
  inactive: renderInactive,
  deleted: renderDeleted,
  settings: renderSettings,
};

function showBootOverlay(visible) {
  const el = document.getElementById('bootOverlay');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

function downloadBackup() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fop-oblik-${todayIso()}.json`;
  link.click();
  // Some desktop webviews start the download on the next event-loop turn.
  // Revoke only afterwards so a large backup is never saved as an empty file.
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast('Резервну копію завантажено.', 'success');
}

export function render() {
  const [crumb, title] = TITLES[uiState.view];
  $('#crumb').textContent = crumb;
  $('#title').textContent = title;
  $('#content').innerHTML = VIEWS[uiState.view]();
  bindCurrentView();
  enhanceDateInputs($('#content'));
  applyAppearance();
  applyRoleAccess();
  requestAnimationFrame(() => {
    setupTopScrollbars();
    if (uiState.view === 'payments') positionPaymentsTable();
    if (uiState.pendingHighlightClientId) {
      const targetId = uiState.pendingHighlightClientId;
      uiState.pendingHighlightClientId = null;
      const rows = document.querySelectorAll(`tr[data-row-id="${targetId}"]`);
      rows.forEach((row) => {
        row.classList.add('row-highlight');
        setTimeout(() => row.classList.remove('row-highlight'), 2600);
      });
      if (rows[0]?.scrollIntoView) rows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function applyRoleAccess() {
  const observer = uiState.currentUser?.role === 'observer';
  document.body.classList.toggle('observer-mode', observer);
  $('#quickNote').hidden = observer;
  $('#exportBtn').hidden = observer;
  if (!observer) return;
  document.querySelectorAll('#content input, #content select, #content textarea').forEach((field) => { field.disabled = true; });
  document.querySelectorAll('#content button.primary, #content button.danger, #content .icon, #content [data-export-clients], #content [data-import-clients]').forEach((button) => { button.disabled = true; });
}

function applyAppearance(appearance = getSettings()?.appearance || { fieldColor: '#ffffff', fieldRadius: 5, fieldOpacity: 0 }, target = document.documentElement) {
  const hex = String(appearance.fieldColor || '#ffffff').replace('#', '');
  const rgb = hex.length === 6 ? `${parseInt(hex.slice(0, 2), 16)} ${parseInt(hex.slice(2, 4), 16)} ${parseInt(hex.slice(4, 6), 16)}` : '255 255 255';
  target.style.setProperty('--field-rgb', rgb);
  target.style.setProperty('--field-opacity', String(1 - Number(appearance.fieldOpacity ?? 0) / 100));
  target.style.setProperty('--field-radius', `${Number(appearance.fieldRadius ?? 5)}px`);
}

function setView(view) {
  if (view === 'deleted' && !uiState.deletedSectionUnlocked) return;
  uiState.view = view;
  document.querySelectorAll('#nav button').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  render();
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
  saveCalendarEvent({ eventDate: result.date, eventTime: result.time || '', title: result.title, note: result.note, clientId, recurrence: savedRecurrence, workdayShift, completedAt: existing?.completedAt || '', completedDates: existing?.completedDates || [] }, existing?.id);
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
  document.querySelectorAll('[data-calendar-day]').forEach((cell) => cell.addEventListener('click', () => { uiState.calendarTaskDate = cell.dataset.calendarDay; uiState.calendarSection = 'tasks'; render(); }));
  document.querySelectorAll('[data-calendar-event]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = button.dataset.calendarTarget;
    if (target) {
      const [, group, period] = target.split('|');
      uiState.view = 'taxes'; uiState.taxGroup = group; uiState.taxPeriod = period;
      document.querySelectorAll('#nav button').forEach((item) => item.classList.toggle('active', item.dataset.view === 'taxes'));
      render(); return;
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
  document.querySelector('[data-hr-doc-prev]')?.addEventListener('click', () => { if (uiState.hrDocumentsMonth > 1) { uiState.hrDocumentsMonth -= 1; render(); } });
  document.querySelector('[data-hr-doc-next]')?.addEventListener('click', () => { if (uiState.hrDocumentsMonth < 12) { uiState.hrDocumentsMonth += 1; render(); } });
  document.querySelectorAll('[data-hr-document]').forEach((button) => button.addEventListener('click', () => {
    const next = button.textContent.trim() === 'Надіслано' ? 'Не надіслано' : 'Надіслано';
    setHrMonthlyDocumentStatus(button.dataset.hrDocument, button.dataset.hrPeriod, button.dataset.hrField, next);
    render();
  }));
  document.querySelector('[data-payroll-prev]')?.addEventListener('click', () => { if (uiState.payrollMonth > 1) { uiState.payrollMonth -= 1; render(); } });
  document.querySelector('[data-payroll-next]')?.addEventListener('click', () => { if (uiState.payrollMonth < 12) { uiState.payrollMonth += 1; render(); } });
  document.querySelector('[data-add-payroll-client]')?.addEventListener('click', async () => {
    const clients = getVisibleClients().filter((client) => (client.employees || []).length);
    const month = uiState.payrollMonth;
    const monthNamesGenitive = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
    const previousMonth = monthNamesGenitive[month === 1 ? 11 : month - 2];
    const currentMonth = monthNamesGenitive[month - 1];
    const paymentTypes = [`Виплата за другу половину ${previousMonth}`, `Виплата за першу половину ${currentMonth}`, 'Звільнення', 'Відпустка', 'Лікарняні'];
    const result = await openAppDialog({ title: 'Додати ФОП до виплати зарплати', fields: [{ key: 'client', label: 'ФОП', required: true, options: clients.map((client) => client.name) }, { key: 'paymentType', label: 'Тип виплати', type: 'select', required: true, value: paymentTypes[0], options: paymentTypes }], confirmText: 'Додати' });
    if (!result) return;
    const client = clients.find((item) => item.name === result.client);
    if (!client) { showToast('Оберіть ФОП зі списку.', 'error'); return; }
    const period = `${getSettings().workingYear}-${String(uiState.payrollMonth).padStart(2, '0')}`;
    const added = addPayrollForClient(client.id, period, result.paymentType);
    showToast(`Додано працівників: ${added}.`, 'success');
    render();
  });
  document.querySelector('[data-add-payroll-employee]')?.addEventListener('click', async () => {
    const choices = getVisibleClients().flatMap((client) => (client.employees || []).map((employee) => ({ client, employee, label: `${client.name} — ${employee.name}` })));
    const month = uiState.payrollMonth;
    const monthNamesGenitive = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
    const previousMonth = monthNamesGenitive[month === 1 ? 11 : month - 2];
    const currentMonth = monthNamesGenitive[month - 1];
    const paymentTypes = [`Виплата за другу половину ${previousMonth}`, `Виплата за першу половину ${currentMonth}`, 'Звільнення', 'Відпустка', 'Лікарняні'];
    const result = await openAppDialog({ title: 'Додати працівника до виплати', fields: [{ key: 'employee', label: 'ФОП і працівник', required: true, options: choices.map((choice) => choice.label) }, { key: 'paymentType', label: 'Тип виплати', type: 'select', required: true, value: paymentTypes[0], options: paymentTypes }], confirmText: 'Додати' });
    if (!result) return;
    const choice = choices.find((item) => item.label === result.employee);
    if (!choice) { showToast('Оберіть працівника зі списку.', 'error'); return; }
    const period = `${getSettings().workingYear}-${String(uiState.payrollMonth).padStart(2, '0')}`;
    addPayrollEmployee(choice.client.id, choice.employee.id, period, result.paymentType);
    showToast('Рядок працівника додано.', 'success');
    render();
  });
  document.querySelectorAll('[data-delete-payroll]').forEach((button) => button.addEventListener('click', () => {
    deletePayrollRecord(button.dataset.deletePayroll);
    render();
  }));
  const payrollDateToIso = (value) => {
    const parts = value.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (!parts) return null;
    const iso = `20${parts[3]}-${parts[2]}-${parts[1]}`;
    const parsed = new Date(`${iso}T00:00:00`);
    return parsed.getFullYear() === Number(`20${parts[3]}`) && parsed.getMonth() + 1 === Number(parts[2]) && parsed.getDate() === Number(parts[1]) ? iso : null;
  };
  const savePayrollDate = (field, iso) => { setPayrollField(field.dataset.payrollId, 'paymentDate', iso); render(); };
  document.querySelectorAll('.payroll-date-field').forEach((field) => field.addEventListener('input', () => {
    const digitPosition = field.value.slice(0, field.selectionStart || 0).replace(/\D/g, '').length;
    const digits = field.value.replace(/\D/g, '').slice(0, 6);
    const formatted = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join('.');
    field.value = formatted;
    const cursor = digitPosition <= 2 ? digitPosition : digitPosition <= 4 ? digitPosition + 1 : digitPosition + 2;
    field.setSelectionRange(cursor, cursor);
    if (digits.length === 6) {
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
      if (value && !iso) { showToast('Вкажіть дату у форматі дд.мм.рр.', 'error'); return; }
      value = iso;
    }
    setPayrollField(field.dataset.payrollId, field.dataset.payrollField, value); render();
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
    const now = new Date();
    const localValue = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const result = await openAppDialog({
      title: 'Відкат змін',
      message: 'Буде відновлено стан даних перед першою зміною після вибраного моменту. Записи журналу не зникнуть: їх буде позначено скасованими.',
      fields: [{ key: 'cutoff', label: 'Скасувати зміни після дати й часу', type: 'datetime-local', value: localValue, required: true }],
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
    const employeeNames = getVisibleClients().flatMap((client) => (client.employees || []).map((employee) => employee.name)).filter(Boolean);
    const clients = getVisibleClients();
    const result = await openAppDialog({ title: 'Новий кадровий документ', message: 'Внесіть реквізити документа та оберіть ФОП, якому його потрібно надіслати.', fields: [{ key: 'client', label: 'ФОП', required: true, options: clients.map((client) => client.name) }, { key: 'number', label: 'Номер документа', required: true }, { key: 'date', label: 'Дата документа', type: 'date', value: todayIso(), required: true }, { key: 'subject', label: 'Суть документа', required: true }, { key: 'employeeName', label: 'ПІБ працівника (необов’язково)', options: employeeNames }, { key: 'effectiveDate', label: 'Дата початку дії', type: 'date', value: todayIso(), required: true }, { key: 'deliveryStatus', label: 'Статус надсилання', value: 'Не надіслано', required: true, options: ['Не надіслано', 'Надіслано'] }], confirmText: 'Зберегти' });
    if (!result) return;
    const clientId = clients.find((client) => client.name === result.client)?.id;
    if (!clientId) { showToast('Оберіть ФОП зі списку.', 'error'); return; }
    const period = `${getSettings().workingYear}-${String(uiState.hrDocumentsMonth || 1).padStart(2, '0')}`;
    saveHrOrder({ ...result, clientId, period }); render();
  });
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
  document.querySelector('[data-check-all-kved]')?.addEventListener('click', () => {
    const entries = getVisibleClients().flatMap((client) => validateKved(client).map((entry) => ({ ...entry, clientName: client.name })));
    openKvedResults('Масова перевірка КВЕД', entries, true, true);
  });

  // --- Перетягування рядків (Картки клієнтів) ---
  const clientRows = [...document.querySelectorAll('[data-client-row]')];
  document.querySelectorAll('[data-drag-handle]').forEach((handle) => {
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
    uiState.view = section;
    if (section === 'taxes') { uiState.taxGroup = button.dataset.alertGroup; uiState.taxPeriod = button.dataset.alertPeriod; }
    if (section === 'reports') { uiState.reportGroup = button.dataset.alertGroup; uiState.reportPeriod = button.dataset.alertPeriod; }
    if (section === 'incomes') uiState.incomeGroup = button.dataset.alertGroup;
    uiState.pendingHighlightClientId = button.dataset.alertClient;
    document.querySelectorAll('#nav button').forEach((item) => item.classList.toggle('active', item.dataset.view === section));
    render();
  });

  // --- Податки ---
  document.querySelectorAll('[data-tax-group]').forEach((b) => b.onclick = () => { uiState.taxGroup = b.dataset.taxGroup; uiState.taxPeriod = null; render(); });
  document.querySelectorAll('[data-tax-period]').forEach((b) => b.onclick = () => { uiState.taxPeriod = b.dataset.taxPeriod; render(); });
  document.querySelectorAll('.tax-field').forEach((field) => field.addEventListener('change', () => {
    setTaxField(field.dataset.client, field.dataset.realGroup, uiState.taxPeriod, field.dataset.tax, field.dataset.field, field.value);
    render();
  }));
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

  // --- Звітність ---
  document.querySelectorAll('[data-report-group]').forEach((b) => b.onclick = () => { uiState.reportGroup = b.dataset.reportGroup; uiState.reportPeriod = null; render(); });
  document.querySelectorAll('[data-report-period]').forEach((b) => b.onclick = () => { uiState.reportPeriod = b.dataset.reportPeriod; render(); });
  document.querySelectorAll('.report-field').forEach((field) => field.addEventListener('change', () => {
    setReportField(field.dataset.client, field.dataset.realGroup, uiState.reportPeriod, field.dataset.field, field.value);
    render();
  }));

  // --- Доходи ---
  document.querySelectorAll('[data-income-group]').forEach((b) => b.onclick = () => { uiState.incomeGroup = b.dataset.incomeGroup; render(); });
  document.querySelectorAll('.income-value').forEach((field) => field.addEventListener('change', () => {
    setIncomeValue(field.dataset.client, field.dataset.month, field.value);
    render();
  }));

  // --- Оплати ---
  document.querySelectorAll('[data-payments-quarter]').forEach((button) => button.addEventListener('click', () => { uiState.paymentsQuarter = Number(button.dataset.paymentsQuarter); render(); }));
  document.querySelectorAll('.month-value').forEach((field) => field.addEventListener('change', () => {
    setMonthlyPaymentField(field.dataset.client, field.dataset.month, field.dataset.type, field.value);
    render();
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
  $('[data-download-backup]')?.addEventListener('click', downloadBackup);
  $('[data-restore-backup]')?.addEventListener('click', () => $('#backupRestoreFile')?.click());
  $('#backupRestoreFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const result = await openAppDialog({
        title: 'Відновити резервну копію',
        message: 'Поточні локальні дані буде замінено вмістом файлу. Відновлені дані буде синхронізовано з робочим простором. Введіть ВІДНОВИТИ для підтвердження.',
        fields: [{ key: 'confirmation', label: 'Підтвердження', required: true }],
        confirmText: 'Відновити дані',
        danger: true,
      });
      if (!result || result.confirmation !== 'ВІДНОВИТИ') return;
      await replaceDatabase(backup);
      requestSync();
      render();
      showToast('Резервну копію відновлено. Запущено синхронізацію.', 'success', 7000);
    } catch (error) {
      showToast(`Не вдалося відновити резервну копію: ${error.message || error}`, 'error', 9000);
    }
  });
  $('#f_minWage')?.addEventListener('change', () => { setMinWage($('#f_minWage').value); render(); });
  document.querySelectorAll('.settings-field').forEach((field) => field.addEventListener('change', () => {
    if (field.dataset.scope === 'monthly') setMonthlyTaxDeadline(field.dataset.period, field.value);
    else if (field.dataset.scope === 'quarterly') setQuarterlyTaxDeadline(field.dataset.tax, field.dataset.period, field.value);
    else if (field.dataset.scope === 'report-annual') setReportDeadline('annual', field.dataset.period, field.value);
    else if (field.dataset.scope === 'report-quarterly') setReportDeadline('quarterly', field.dataset.period, field.value);
    render();
  }));
  document.querySelectorAll('[data-settings-section]').forEach((button) => button.addEventListener('click', async () => {
    uiState.settingsSection = button.dataset.settingsSection;
    if (uiState.settingsSection === 'users') {
      try { uiState.managedUsers = await listAuthenticationUsers(); }
      catch (error) { showToast(error.message || String(error), 'error'); }
    }
    if (uiState.settingsSection === 'conflicts') {
      try { uiState.syncConflicts = await getOpenSyncConflicts(); }
      catch (error) { showToast(error.message || String(error), 'error'); }
    }
    render();
  }));
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
    const result = await openAppDialog({ title: 'Новий користувач', message: 'Користувач входитиме за логіном і паролем. Електронна пошта для нього не потрібна.', fields: [{ key: 'login', label: 'Логін', required: true }, { key: 'displayName', label: 'Ім’я', required: true }, { key: 'role', label: 'Роль', type: 'select', options: ['accountant', 'observer', 'administrator'], value: 'accountant', required: true }, { key: 'password', label: 'Пароль (щонайменше 8 символів)', type: 'password', required: true }], confirmText: 'Створити' });
    if (!result) return;
    try { await manageHarmonyUsers('create', result); uiState.managedUsers = await listAuthenticationUsers(); render(); showToast('Користувача створено.', 'success'); }
    catch (error) { showToast(error.message || String(error), 'error', 8000); }
  });
  document.querySelectorAll('[data-manage-user]').forEach((button) => button.addEventListener('click', async () => {
    const user = uiState.managedUsers.find((item) => item.userId === button.dataset.manageUser);
    if (!user) return;
    const result = await openAppDialog({ title: user.bound ? 'Змінити користувача' : 'Прив’язати користувача', message: user.bound ? 'За потреби задайте новий пароль. Залиште поле порожнім, щоб не змінювати його.' : `Обліковий запис ${user.email || 'Supabase Auth'} буде прив’язано до логіна Harmony.`, fields: [{ key: 'login', label: 'Логін', value: user.login, required: true }, { key: 'displayName', label: 'Ім’я', value: user.displayName, required: true }, { key: 'role', label: 'Роль', type: 'select', options: ['accountant', 'observer', 'administrator'], value: user.role, required: true }, { key: 'password', label: 'Новий пароль', type: 'password' }, { key: 'isActive', label: 'Статус', type: 'select', options: ['Активний', 'Вимкнений'], value: user.isActive ? 'Активний' : 'Вимкнений', required: true }], confirmText: 'Зберегти' });
    if (!result) return;
    try {
      const action = user.bound ? 'update' : 'bind';
      await manageHarmonyUsers(action, { ...result, userId: user.userId, isActive: result.isActive === 'Активний' });
      uiState.managedUsers = await listAuthenticationUsers(); render(); showToast('Дані користувача збережено.', 'success');
    } catch (error) { showToast(error.message || String(error), 'error', 8000); }
  }));
  const previewAppearance = () => Object.fromEntries([...document.querySelectorAll('[data-appearance]')].map((field) => [field.dataset.appearance, field.value]));
  document.querySelectorAll('[data-appearance]').forEach((field) => field.addEventListener('change', () => applyAppearance(previewAppearance(), document.querySelector('#appearancePreview'))));
  document.querySelector('[data-save-appearance]')?.addEventListener('click', () => {
    const appearance = previewAppearance();
    Object.entries(appearance).forEach(([key, value]) => setAppearanceSetting(key, key === 'fieldColor' ? value : Number(value)));
    applyAppearance();
    showToast('Зовнішній вигляд збережено.', 'success');
  });

  // --- Неактивні ---
  document.querySelectorAll('[data-restore-client]').forEach((b) => b.onclick = () => {
    archiveClient(b.dataset.restoreClient, false);
    render();
  });
  document.querySelectorAll('[data-request-delete-client]').forEach((b) => b.onclick = async () => {
    const item = getClientById(b.dataset.requestDeleteClient);
    if (!item) return;
    const result = await openAppDialog({ title: 'Запит на видалення', message: `ФОП залишатиметься в «Неактивних» ще 30 днів. Введіть повний ПІБ і причину.`, fields: [{ key: 'name', label: `Повний ПІБ: ${item.name}`, required: true }, { key: 'reason', label: 'Причина видалення', required: true }], confirmText: 'Подати запит', danger: true });
    if (!result) return;
    if (result.name !== item.name) { showToast('ПІБ не збігається. Запит на видалення скасовано.', 'error'); return; }
    const eligible = new Date();
    eligible.setDate(eligible.getDate() + 30);
    requestClientDeletion(item.id, result.reason);
    showToast(`Запит підтверджено. До ${eligible.toLocaleDateString('uk-UA')} ФОП залишатиметься неактивним.`, 'info');
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      if (undoLastAction()) { event.preventDefault(); render(); showToast('Останню дію скасовано.', 'info'); }
      return;
    }
    if (event.key.toLowerCase() !== 'h' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
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
    if (email) {
      const result = await openAppDialog({ title: 'Вихід із синхронізації', message: `Вийти з облікового запису ${email}?`, confirmText: 'Вийти', danger: true });
      if (!result) return;
      await signOut();
      setAuditActor();
      uiState.currentUser = null;
      setAccessRole('observer');
      $('#userIdentity').textContent = 'CRM для бухгалтера ФОП';
      $('#authBtn').textContent = 'Увійти для синхронізації';
      showToast('Ви вийшли з облікового запису.', 'info');
      return;
    }
    const credentials = await openAppDialog({ title: 'Вхід для синхронізації', message: 'Введіть логін і пароль, які визначив адміністратор.', fields: [{ key: 'login', label: 'Логін', required: true }, { key: 'password', label: 'Пароль', type: 'password', required: true }], confirmText: 'Увійти' });
    if (!credentials) return;
    try {
      const session = await signIn(credentials.login, credentials.password);
      uiState.currentUser = await getCurrentHarmonyUser();
      if (!uiState.currentUser) throw new Error('Для цього облікового запису не задано активний профіль Harmony. Зверніться до адміністратора.');
      setAuditActor(uiState.currentUser.displayName);
      setAccessRole(uiState.currentUser.role);
      $('#authBtn').textContent = `Вийти (${uiState.currentUser.displayName})`;
      $('#userIdentity').textContent = uiState.currentUser.displayName;
      requestSync();
      showToast('Вхід виконано. Запущено синхронізацію.', 'success');
    } catch (error) { showToast(error.message || String(error), 'error', 8000); }
  });

  $('#modalForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('#modalForm').reportValidity()) return;
    if (handleModalSubmit()) { closeModal(); render(); }
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) closeModal(); });

  $('#exportBtn').addEventListener('click', downloadBackup);

  document.addEventListener('harmony:changed', () => render());
  document.addEventListener('harmony:access-denied', () => { showToast('У вас є доступ лише до перегляду.', 'warn'); render(); });
  window.addEventListener('harmony:sync-conflict', (event) => {
    const count = Number(event.detail?.conflicts?.length || 1);
    showToast(`Виявлено конфлікт синхронізації${count > 1 ? ` (${count})` : ''}. Локальні зміни збережено; віддалені дані не перезаписано.`, 'warn', 9000);
  });
  window.addEventListener('harmony:remote-sync', async () => {
    try {
      await refreshDatabaseFromSync();
      render();
    } catch (error) {
      console.error('Не вдалося оновити дані після синхронізації:', error);
    }
  });

  bindTopScrollbarResize();
}

/** Check installed desktop builds only; Vite in a browser never attempts an update. */
async function checkForUpdate() {
  if (!window.__TAURI_INTERNALS__) return;
  try {
    const update = await check();
    if (!update) return;
    const result = await openAppDialog({
      title: `Доступне оновлення ${update.version}`,
      message: update.body || 'Доступна нова версія Harmony. Програма завантажить і встановить її, після чого перезапуститься.',
      confirmText: 'Оновити зараз',
    });
    if (!result) return;
    showToast('Завантаження оновлення…', 'info', 0);
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    // Updates are optional: an unavailable release must never block accounting work.
    console.info('Перевірка оновлень недоступна:', error);
  }
}

async function boot() {
  showBootOverlay(true);
  try {
    await initDatabase();
    try { await loadActivityReference(); } catch (error) { console.warn('Не вдалося завантажити довідник видів діяльності:', error); }
    wireGlobalControls();
    const email = await signedInEmail();
    if (email) {
      try { uiState.currentUser = await getCurrentHarmonyUser(); } catch (error) { console.warn('Не вдалося прочитати профіль Harmony:', error); }
      const actor = uiState.currentUser?.displayName || email;
      setAuditActor(actor);
      setAccessRole(uiState.currentUser?.role || 'observer');
      $('#authBtn').textContent = `Вийти (${actor})`;
      $('#userIdentity').textContent = actor;
    }
    setView('overview');
    void checkForUpdate();
  } catch (error) {
    // Захист від "тихого зависання": яка б помилка не сталась при старті,
    // overlay має зникнути, а причина — бути видимою (консоль + toast),
    // а не просто вічний напис "Завантаження даних".
    console.error('Помилка запуску застосунку:', error);
    showToast(`Помилка запуску: ${error.message || error}`, 'error', 10000);
  } finally {
    showBootOverlay(false);
  }
}

boot();
