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
  db, initDatabase, refreshDatabaseFromSync, getClientById, deleteClientPermanently, archiveClient, requestClientDeletion, setClientLifecycle, reorderClients, setCustomFieldValue,
  setMonthlyPaymentField, setTaxField, setReportField, setIncomeValue,
  setWorkingYear, createWorkingYear, setMinWage, setMonthlyTaxDeadline, setQuarterlyTaxDeadline, setReportDeadline, getSettings,
  deleteCustomColumn, getCustomColumns,
  copyTaxPeriodForward, getVisibleClients,
} from './state.js';
import { TAX_TYPES, previousPeriodKey, taxPeriodsFor } from './tax-model.ts';
import { setupTopScrollbars, bindTopScrollbarResize } from './render/layout.js';
import { renderOverview } from './render/overview.js';
import { renderDashboard } from './render/dashboard.js';
import { renderPayments, positionPaymentsTable } from './render/payments.js';
import { renderTaxes } from './render/taxes.js';
import { renderIncomes } from './render/incomes.js';
import { renderReports } from './render/reports.js';
import { renderInactive } from './render/inactive.js';
import { renderDeleted } from './render/deleted.js';
import { renderSettings } from './render/settings.js';
import { openColumnForm, handleModalSubmit, closeModal } from './modals.js';
import { openClientCard } from './client-card-ui.js';
import { exportClientsToExcel, importClientsFromFile } from './import-export.js';
import { showToast } from './toast.js';
import { openAppDialog } from './app-dialog.js';
import { signIn, signOut, signedInEmail } from './auth/session';
import { requestSync } from './storage.js';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const TITLES = {
  overview: ['Огляд', 'Зведення зауважень по розділах'],
  dashboard: ['Картки клієнтів', 'Картки клієнтів ФОП'],
  payments: ['Оплати', 'Оплати бухгалтерських послуг'],
  taxes: ['Податки', 'Сплата податків по групах ЄП'],
  incomes: ['Доходи', 'Облік доходів і залишку ліміту'],
  reports: ['Звітність', 'Подання звітів по групах ЄП'],
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
  inactive: renderInactive,
  deleted: renderDeleted,
  settings: renderSettings,
};

function showBootOverlay(visible) {
  const el = document.getElementById('bootOverlay');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

export function render() {
  const [crumb, title] = TITLES[uiState.view];
  $('#crumb').textContent = crumb;
  $('#title').textContent = title;
  $('#quickAdd').style.display = uiState.view === 'dashboard' ? 'block' : 'none';
  $('#content').innerHTML = VIEWS[uiState.view]();
  bindCurrentView();
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

function setView(view) {
  if (view === 'deleted' && !uiState.deletedSectionUnlocked) return;
  uiState.view = view;
  document.querySelectorAll('#nav button').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  render();
}

function bindCurrentView() {
  // --- Картка клієнта ---
  document.querySelectorAll('[data-open-card]').forEach((button) => {
    button.onclick = () => openClientCard(button.dataset.openCard);
  });

  // --- Перетягування рядків (Картки клієнтів) ---
  let dragSourceId = null;
  document.querySelectorAll('tr[draggable="true"]').forEach((row) => {
    row.addEventListener('dragstart', () => { dragSourceId = row.dataset.rowId; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragSourceId = null; });
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!dragSourceId || dragSourceId === row.dataset.rowId) return;
      reorderClients(dragSourceId, row.dataset.rowId);
      render();
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
    $('#deletedNav').hidden = false;
    setView('deleted');
  });
  $('#f_minWage')?.addEventListener('change', () => { setMinWage($('#f_minWage').value); render(); });
  document.querySelectorAll('.settings-field').forEach((field) => field.addEventListener('change', () => {
    if (field.dataset.scope === 'monthly') setMonthlyTaxDeadline(field.dataset.period, field.value);
    else if (field.dataset.scope === 'quarterly') setQuarterlyTaxDeadline(field.dataset.tax, field.dataset.period, field.value);
    else if (field.dataset.scope === 'report-annual') setReportDeadline('annual', field.dataset.period, field.value);
    else if (field.dataset.scope === 'report-quarterly') setReportDeadline('quarterly', field.dataset.period, field.value);
    render();
  }));

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
  $('[data-export-clients]')?.addEventListener('click', () => exportClientsToExcel());
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
    if (event.key.toLowerCase() !== 'h' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const now = Date.now();
    hPresses = hPresses.filter((time) => now - time < 2000);
    hPresses.push(now);
    if (hPresses.length < 5 || uiState.deletedSectionUnlocked) return;
    uiState.deletedSectionUnlocked = true;
    $('#deletedNav').hidden = false;
    showToast('Розділ «Видалені» відкрито на цей сеанс.', 'info');
  });

  $('#quickAdd').addEventListener('click', () => openClientCard(null));

  $('#authBtn').addEventListener('click', async () => {
    const email = await signedInEmail();
    if (email) {
      const result = await openAppDialog({ title: 'Вихід із синхронізації', message: `Вийти з облікового запису ${email}?`, confirmText: 'Вийти', danger: true });
      if (!result) return;
      await signOut();
      $('#authBtn').textContent = 'Увійти для синхронізації';
      showToast('Ви вийшли з облікового запису.', 'info');
      return;
    }
    const credentials = await openAppDialog({ title: 'Вхід для синхронізації', message: 'Використайте облікові дані Supabase.', fields: [{ key: 'email', label: 'Ел. пошта', type: 'email', required: true }, { key: 'password', label: 'Пароль', type: 'password', required: true }], confirmText: 'Увійти' });
    if (!credentials) return;
    try {
      const session = await signIn(credentials.email, credentials.password);
      $('#authBtn').textContent = `Вийти (${session.user?.email || credentials.email})`;
      requestSync();
      showToast('Вхід виконано. Запущено синхронізацію.', 'success');
    } catch (error) { showToast(error.message || String(error), 'error', 8000); }
  });

  $('#modalForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('#modalForm').reportValidity()) return;
    if (handleModalSubmit()) { closeModal(); render(); }
  });
  $('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) closeModal(); });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fop-oblik-${todayIso()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.addEventListener('harmony:changed', () => render());
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
    wireGlobalControls();
    const email = await signedInEmail();
    if (email) $('#authBtn').textContent = `Вийти (${email})`;
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
