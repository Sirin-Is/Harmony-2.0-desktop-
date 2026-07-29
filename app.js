const $ = (s) => document.querySelector(s);
const year = new Date().getFullYear();
const paymentYear = 2026;
const dateToday = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID();
const money = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' });
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = (value) => Number(value) || 0;
function showAppToast(message, type = 'info', duration = 4000) {
  let container = document.querySelector('.toast-stack');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-stack';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  if (duration > 0) {
    setTimeout(() => toast.remove(), duration);
  }
  return toast;
}
window.showToast = showAppToast;

// Annual income limits are legally defined as a multiple of the minimum wage (МЗП).
// The multipliers themselves are fixed by law; the МЗП amount is editable in "Налаштування"
// so the limits automatically stay correct when the minimum wage changes.
const GROUP_MZP_MULTIPLIERS = { '1': 167, '2': 834, '3': 1167 };
function groupLimitAmount(group) {
  const multiplier = GROUP_MZP_MULTIPLIERS[group];
  return multiplier ? multiplier * number(db.settings.minWage) : 0;
}
function groupLimitLabel(group) {
  const multiplier = GROUP_MZP_MULTIPLIERS[group];
  return multiplier ? `${money.format(groupLimitAmount(group))} (${multiplier} МЗП)` : 'Не застосовується';
}

const MONTH_NAMES_UA = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MONTH_SHORT_UA = ['Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру'];
const TAX_TYPES = [
  { key: 'unified', label: 'Єдиний податок' },
  { key: 'military', label: 'Військовий збір' },
  { key: 'esv', label: 'ЄСВ' },
];
const PAYMENT_QUARTERS = [
  { key: 'q1', label: 'I квартал', months: [0, 1, 2] },
  { key: 'q2', label: 'II квартал', months: [3, 4, 5] },
  { key: 'q3', label: 'III квартал', months: [6, 7, 8] },
  { key: 'q4', label: 'IV квартал', months: [9, 10, 11] },
];
// Quarterly bucket keys reused from the group-3 tax period naming (q1/half/9m/year).
// Their calendar END dates line up exactly with plain calendar quarters (Q1..Q4),
// so the same 4 keys double as "which quarter is this month/period in".
function quarterKeyForMonthIndex(monthIndex) {
  return ['q1', 'q1', 'q1', 'half', 'half', 'half', '9m', '9m', '9m', 'year', 'year', 'year'][monthIndex];
}
function quarterKeyForMonthKey(monthKey) {
  return quarterKeyForMonthIndex(Number(monthKey.slice(5, 7)) - 1);
}

// ---------------------------------------------------------------------------
// Supabase persistence layer (replaces localStorage entirely).
// The whole `db` object is stored as ONE JSONB row — see README for the SQL
// schema. This keeps every other function in this file (which reads/writes
// db.clients, db.taxRecords, etc. directly and calls persist() after any
// change) completely unchanged; only loading/saving became async.
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://ldicshjvdxdfilucflkd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qGdzVye18oHS9OTyY-iSOw_luPuJNut';
const SUPABASE_TABLE = 'app_state';
const SUPABASE_ROW_ID = 'harmony';
const SUPABASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

function setSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const labels = {
    loading: '⏳ Завантаження з Supabase…',
    saving: '⏳ Збереження…',
    saved: '✓ Збережено в Supabase',
    error: '⚠ Немає з’єднання із Supabase',
  };
  el.textContent = labels[status] || '';
  el.className = `sync-status sync-${status}`;
}
function showBootOverlay(visible) {
  const el = document.getElementById('bootOverlay');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

/** Fill in every field this app expects, whether `raw` came from Supabase, was empty, or is from an older schema version missing newer fields. */
function applyDefaults(raw) {
  const target = raw && typeof raw === 'object' ? raw : {};
  target.clients ||= []; target.incomes ||= []; target.taxes ||= []; target.payments ||= [];
  target.monthlyPayments ||= {};
  target.customColumns ||= [];
  target.taxRecords ||= {};
  target.incomeRecords ||= {};
  target.reportRecords ||= {};
  target.settings ||= {};
  target.settings.minWage ??= 8647; // 2026 МЗП — matches the previous hardcoded 167/834/1167 МЗП limits exactly
  target.settings.monthlyDeadlines ||= {};
  target.settings.quarterlyDeadlines ||= {};
  target.settings.quarterlyDeadlines.group3 ||= {};
  target.settings.quarterlyDeadlines.esv ||= {};
  target.settings.reportDeadlines ||= {};
  target.settings.reportDeadlines.annual ??= '';
  target.settings.reportDeadlines.quarterly ||= { q1: '', half: '', '9m': '', year: '' };
  return target;
}

let db = applyDefaults(null); // safe empty default so top-level code can reference db synchronously before Supabase responds
let view = 'overview';
let taxGroup = '12';
let taxPeriod = null;
let reportGroup = '12';
let reportPeriod = null;
let incomeGroup = '12';
let paymentsQuarter = null;
let pendingHighlightClientId = null;
let onSave = null;

async function loadFromSupabase() {
  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${SUPABASE_ROW_ID}&select=data`;
  const res = await fetch(url, { headers: SUPABASE_HEADERS });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0]?.data ?? null;
}

let saveTimer = null;
let savePending = false;
/** Debounced save: collapses rapid successive edits (typing, dragging) into one network request ~800ms after the last change. */
function persist() {
  savePending = true;
  setSyncStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPersist, 800);
}
async function flushPersist() {
  clearTimeout(saveTimer);
  if (!savePending) return;
  savePending = false;
  try {
    const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...SUPABASE_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ id: SUPABASE_ROW_ID, data: db, updated_at: new Date().toISOString() }]),
      keepalive: true, // let the request finish even if the window is closing
    });
    if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`);
    setSyncStatus('saved');
  } catch (error) {
    console.error('Не вдалося зберегти дані в Supabase:', error);
    setSyncStatus('error');
    savePending = true; // retry on the next edit or page unload
  }
}
window.addEventListener('beforeunload', () => { if (savePending) flushPersist(); });

async function boot() {
  showBootOverlay(true);
  setSyncStatus('loading');
  try {
    const remote = await loadFromSupabase();
    db = applyDefaults(remote);
    setSyncStatus('saved');
  } catch (error) {
    console.error('Не вдалося завантажити дані з Supabase:', error);
    setSyncStatus('error');
    alert('Не вдалося з’єднатися з базою даних Supabase. Перевірте інтернет-з’єднання. Застосунок відкриється з порожньою базою для цього сеансу — зміни не збережуться, доки з’єднання не відновиться.');
  }
  showBootOverlay(false);
  render();
}

function client(id) { return db.clients.find((item) => item.id === id); }
function input(id) { return document.getElementById(`f_${id}`)?.value.trim() ?? ''; }
function clientOptions(selected = '') { return db.clients.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join(''); }
function empty(message) { return `<p class="empty">${message}</p>`; }
function rateText(item) { return String(item.group) === '3' && String(item.rate) === '0.03' ? '3% + ПДВ' : number(item.rate) ? `${number(item.rate) * 100}%` : '—'; }
function customFields(item) { return db.customColumns.map((column) => `<td><input class="custom-cell" data-client="${item.id}" data-column="${column.id}" type="${column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}" placeholder="—" value="${esc(item.customFields?.[column.id] || '')}"></td>`).join(''); }
function customInputs(item) { return db.customColumns.map((column) => `<label><span>${esc(column.name)}</span><input id="f_custom_${column.id}" type="${column.type}" value="${esc(item.customFields?.[column.id] || '')}"></label>`).join(''); }
function phoneLines(value) {
  const parts = String(value || '').split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.map(esc).join('<br>') : '—';
}
function contactLinkHtml(item) {
  const raw = (item.contactLink || '').trim();
  if (!raw) return '—';
  const safeHref = /^https?:\/\//i.test(raw) ? raw : (/^t\.me\//i.test(raw) ? `https://${raw}` : null);
  return safeHref ? `<a href="${esc(safeHref)}" target="_blank" rel="noopener noreferrer">${esc(raw)}</a>` : esc(raw);
}
function employeesLabel(item) {
  const count = number(item.employeesCount);
  return count > 0 ? String(count) : 'немає';
}
/**
 * Short display name for use everywhere EXCEPT "Загальні дані" (which always
 * shows the full ПІБ). Normally: "Прізвище І.П." (surname + initials). If
 * another active-or-archived client shares the same surname, initials alone
 * could be ambiguous, so those clients show "Прізвище Ім'я" (full first
 * name, no patronymic) instead.
 */
function surnameOf(fullName) { return (fullName || '').trim().split(/\s+/)[0] || ''; }
function shortName(item) {
  const parts = (item.name || '').trim().split(/\s+/);
  const surname = parts[0] || '';
  const first = parts[1] || '';
  const patronymic = parts[2] || '';
  if (!surname) return esc(item.name || '');
  const hasSurnameCollision = db.clients.some((other) => other.id !== item.id && surnameOf(other.name).toLowerCase() === surname.toLowerCase());
  if (hasSurnameCollision) return esc(first ? `${surname} ${first}` : surname);
  const initials = [first, patronymic].filter(Boolean).map((p) => `${p[0]}.`).join('');
  return esc(initials ? `${surname} ${initials}` : surname);
}
/** Parse a user-typed amount ("1 000,5" / "1000.5" / "") into a clean numeric string ('' = cleared). Returns null if invalid. */
function parseAmountInput(raw) {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return '';
  return Number.isFinite(Number(cleaned)) ? cleaned : null;
}
/** Format a stored numeric string for display with thousands separators; '' for empty/unset (never shows a "-" placeholder). */
function formatAmountDisplay(rawStoredValue) {
  if (rawStoredValue === undefined || rawStoredValue === null || rawStoredValue === '') return '';
  const num = Number(rawStoredValue);
  return Number.isFinite(num) ? num.toLocaleString('uk-UA', { maximumFractionDigits: 2 }) : '';
}
function daysUntilNum(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}
function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}
function kepStatusLabel(dateStr) {
  const diffDays = daysUntilNum(dateStr);
  if (diffDays === null) return '—';
  if (diffDays < 0) return `<span class="pill late">Прострочено ${Math.abs(diffDays)} дн.</span>`;
  if (diffDays === 0) return `<span class="pill warn">Сьогодні</span>`;
  if (diffDays <= 30) return `<span class="pill warn">${diffDays} дн.</span>`;
  return `<span class="pill ok">${diffDays} дн.</span>`;
}
/**
 * Days remaining until a tax deadline. Once the tax is actually paid
 * (record.paidDate set), the count FREEZES as of that payment date
 * instead of continuing to tick relative to today — the number becomes
 * a permanent record of "how early/late was this paid", not a live timer.
 */
function daysUntilLabel(deadline, record) {
  if (!deadline) return '—';
  const paidDate = record?.paidDate;
  const diffDays = paidDate ? daysBetween(paidDate, deadline) : daysUntilNum(deadline);
  if (diffDays === null) return '—';
  if (diffDays < 0) return `<span class="pill late">${diffDays} дн.</span>`;
  if (!paidDate && diffDays <= 7) return `<span class="pill warn">${diffDays} дн.</span>`;
  return `<span class="pill ok">${diffDays} дн.</span>`;
}
function taxPeriodsFor(group) {
  if (group === '3') return [
    { key: 'q1', label: '1 квартал' },
    { key: 'half', label: 'Півріччя' },
    { key: '9m', label: '9 місяців' },
    { key: 'year', label: 'Рік' },
  ];
  return Array.from({ length: 12 }, (_, index) => ({ key: `${paymentYear}-${String(index + 1).padStart(2, '0')}`, label: MONTH_NAMES_UA[index] }));
}
function exemptionOptions(group) {
  const options = ['', 'працевлаштування', 'пенсія', 'ТМБД'];
  if (group === '3') options.splice(3, 0, 'не було доходів');
  return options;
}
function taxRecord(clientId, group, period, taxType) {
  const key = `${clientId}|${group}|${period}|${taxType}`;
  return db.taxRecords[key] ||= {};
}
/** The deadline set in "Налаштування" for this group/tax/period, before any per-client override. */
function getDefaultDeadline(group, taxType, periodKey) {
  if (taxType === 'esv') {
    const quarterKey = group === '3' ? periodKey : quarterKeyForMonthKey(periodKey);
    return db.settings.quarterlyDeadlines.esv[quarterKey] || '';
  }
  if (group === '3') return db.settings.quarterlyDeadlines.group3[periodKey] || '';
  return db.settings.monthlyDeadlines[periodKey] || '';
}
/** A client's own explicit deadline wins; otherwise fall back to the Settings-wide default. */
function effectiveDeadline(group, taxType, periodKey, record) {
  return record.deadline || getDefaultDeadline(group, taxType, periodKey);
}
function getDefaultReportDeadline(group, periodKey) {
  if (group === '3') return db.settings.reportDeadlines.quarterly[periodKey] || '';
  return db.settings.reportDeadlines.annual || '';
}
function reportRecord(clientId, group, period) {
  const key = `${clientId}|${group}|${period}`;
  return db.reportRecords[key] ||= {};
}
function reportPeriodsFor(group) {
  return group === '3' ? taxPeriodsFor('3') : [{ key: String(paymentYear), label: `Рік ${paymentYear}` }];
}
function reportStatus(record, deadline) {
  if (record.submittedDate) return { text: 'Подано', cls: 'ok' };
  const days = daysUntilNum(deadline);
  if (days !== null && days < 0) return { text: 'Пропущено', cls: 'late' };
  if (days !== null && days <= 5) return { text: 'Скоро дедлайн', cls: 'warn' };
  return { text: 'Очікуємо', cls: 'neutral' };
}
function reportStatusPillHtml(record, deadline) {
  const status = reportStatus(record, deadline);
  return `<span class="pill ${status.cls}">${status.text}</span>`;
}
function taxStatus(record, deadline) {
  const effective = deadline ?? record.deadline;
  if (record.exemption) return null;
  if (record.paidDate) {
    if (effective && record.paidDate > effective) return { text: 'Невчасно', cls: 'late' };
    return { text: 'Вчасно', cls: 'ok' };
  }
  if (record.queuedDate) return { text: 'Очікуємо на сплату', cls: 'warn' };
  return { text: 'Набери платіжку', cls: 'neutral' };
}
function statusPillHtml(record, deadline) {
  if (record.exemption) return '—';
  const status = taxStatus(record, deadline);
  return status ? `<span class="pill ${status.cls}">${status.text}</span>` : '—';
}

function table(rows, headings, tableClass = 'table') {
  if (!rows.length) return empty('Записів поки немає.');
  return `<div class="table-wrap"><table class="${tableClass}"><thead><tr>${headings.map((item) => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function openArchiveConfirmation(id, onSuccess = null) {
  const item = client(id);
  if (!item) return;
  openModal('Приховати ФОП', `
    <label class="wide">Введіть повне ПІБ клієнта<input id="f_hideName" value="" required></label>
    <label class="wide">Причина неактивності<textarea id="f_hideReason" required></textarea></label>
    <p class="muted">Після приховування клієнт зникне з «Огляду» та «Оплат», але збережеться в «Неактивних».</p>
  `, () => {
    const enteredName = input('hideName');
    const reason = input('hideReason');
    if (enteredName !== item.name) {
      $('#modalErrors').innerHTML = '<p>Введене ПІБ не збігається з повним ПІБ клієнта.</p>';
      return false;
    }
    if (!reason) {
      $('#modalErrors').innerHTML = '<p>Вкажіть причину неактивності.</p>';
      return false;
    }
    setArchived(item.id, true, reason);
    closeModal();
    if (typeof onSuccess === 'function') onSuccess();
    return false;
  });
}

function render() {
  const titles = {
    overview: ['Огляд', 'Зведення зауважень по розділах'],
    dashboard: ['Картки клієнтів', 'Картки клієнтів ФОП'],
    payments: ['Оплати', 'Оплати бухгалтерських послуг'],
    taxes: ['Податки', 'Сплата податків по групах ЄП'],
    incomes: ['Доходи', 'Облік доходів і залишку ліміту'],
    reports: ['Звітність', 'Подання звітів по групах ЄП'],
    inactive: ['Неактивні', 'Приховані ФОП'],
    settings: ['Налаштування', 'МЗП і дедлайни сплати податків'],
  };
  const views = {
    overview: overviewView, dashboard, payments, taxes, incomes: incomesView, reports: reportsView, inactive: inactiveView, settings: settingsView,
  };
  const [crumb, title] = titles[view];
  $('#crumb').textContent = crumb;
  $('#title').textContent = title;
  $('#quickAdd').style.display = view === 'dashboard' ? 'block' : 'none';
  $('#content').innerHTML = views[view]();
  bindCurrentView();
  requestAnimationFrame(() => {
    setupTopScrollbars();
    if (pendingHighlightClientId) {
      const targetId = pendingHighlightClientId;
      pendingHighlightClientId = null;
      const rows = document.querySelectorAll(`tr[data-row-id="${targetId}"]`);
      rows.forEach((row) => {
        row.classList.add('row-highlight');
        setTimeout(() => row.classList.remove('row-highlight'), 2600);
      });
      if (rows[0] && typeof rows[0].scrollIntoView === 'function') rows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function dashboard() {
  const visible = db.clients.filter((item) => !item.archived);
  const rows = visible.map((item) => {
    return `<tr draggable="true" data-row-id="${item.id}">
      <td class="row-actions">
        <span class="drag-handle" title="Перетягніть, щоб змінити порядок">⋮⋮</span>
        <button class="icon" data-edit-client="${item.id}" title="Редагувати">✎</button>
      </td>
      <td><button type="button" class="link-cell" data-open-card="${item.id}"><strong>${esc(item.name)}</strong></button></td>
      <td>${esc(item.group || '—')}</td>
      <td>${rateText(item)}</td>
      <td>${esc(item.currency || 'немає')}</td>
      <td>${phoneLines(item.phone)}</td>
      <td>${esc(item.email || '—')}</td>
      <td>${contactLinkHtml(item)}</td>
      <td>${esc(item.bankAccess || '—')}</td>
      <td>${esc(item.prro || '—')}</td>
      <td>${employeesLabel(item)}</td>
      <td class="right">${money.format(number(item.serviceCost))}</td>
      <td>${esc(item.kepIssuer || '—')}</td>
      <td>${kepStatusLabel(item.kepExpiry)}</td>
      ${customFields(item)}
    </tr>`;
  });
  const customHeaders = db.customColumns.map((column) => `<span>${esc(column.name)}</span><button class="column-control" data-edit-column="${column.id}" title="Змінити назву">✎</button><button class="column-control" data-delete-column="${column.id}" title="Видалити колонку">×</button>`);
  return `<div class="toolbar"><p class="note">Усі введені ФОП зібрані в одній таблиці, за логікою аркуша «Загальні дані». Перетягніть рядок за ⋮⋮, щоб змінити порядок — він застосується і в «Оплатах».</p><div class="toolbar-actions"><button class="secondary" data-export-clients>Експорт</button><button class="secondary" data-import-clients>Імпортувати з Excel</button><input type="file" id="importFile" accept=".xlsx,.xls,.csv" hidden><button class="secondary" data-add-column>+ Нова колонка</button></div></div>
    ${table(rows, ['ПІБ', 'Група', 'Ставка', 'Валюта', 'Телефон', 'Ел. пошта', 'Зв\'язок', 'Банк', 'П/РРО', 'Наймані', 'Обслуговування', 'Видавець КЕП', 'КЕП дійсний', ...customHeaders])}`;
}

// ---------------------------------------------------------------------------
// Огляд — cross-section summary of things needing attention.
// Each finder below returns entries already shaped for alertNamesHtml()/
// navigation: { id, name, group?, period?, quarter? }. Alerts never expire
// on their own — they simply reflect whatever is true right now, so an
// overdue unpaid tax keeps showing up until it's actually paid.
// ---------------------------------------------------------------------------

function kepAlertEntries() {
  return db.clients.filter((item) => !item.archived).filter((item) => {
    const d = daysUntilNum(item.kepExpiry);
    return d !== null && d < 3;
  }).map((item) => ({ id: item.id, name: item.name }));
}

function taxAlertEntries() {
  const entries = [];
  db.clients.filter((item) => !item.archived && ['1', '2', '3'].includes(String(item.group))).forEach((item) => {
    const realGroup = String(item.group);
    const periods = taxPeriodsFor(realGroup);
    let worst = null;
    periods.forEach((period) => {
      TAX_TYPES.forEach((taxType) => {
        const key = `${item.id}|${realGroup}|${period.key}|${taxType.key}`;
        const record = db.taxRecords[key] || {};
        if (record.exemption || record.paidDate) return;
        const deadline = effectiveDeadline(realGroup, taxType.key, period.key, record);
        if (!deadline) return;
        const days = daysUntilNum(deadline);
        if (days === null || days > 5) return;
        if (!worst || days < worst.days) worst = { period: period.key, days };
      });
    });
    if (worst) entries.push({ id: item.id, name: item.name, group: realGroup === '3' ? '3' : '12', period: worst.period });
  });
  return entries;
}

function reportAlertEntries() {
  const entries = [];
  db.clients.filter((item) => !item.archived && ['1', '2', '3'].includes(String(item.group))).forEach((item) => {
    const realGroup = String(item.group);
    const periods = reportPeriodsFor(realGroup);
    let worst = null;
    periods.forEach((period) => {
      const key = `${item.id}|${realGroup}|${period.key}`;
      const record = db.reportRecords[key] || {};
      if (record.submittedDate) return;
      const deadline = record.deadline || getDefaultReportDeadline(realGroup, period.key);
      if (!deadline) return;
      const days = daysUntilNum(deadline);
      if (days === null || days > 5) return;
      if (!worst || days < worst.days) worst = { period: period.key, days };
    });
    if (worst) entries.push({ id: item.id, name: item.name, group: realGroup === '3' ? '3' : '12', period: worst.period });
  });
  return entries;
}

function serviceDebtAlertEntries() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const entries = [];
  db.clients.filter((item) => !item.archived).forEach((item) => {
    for (let m = 0; m < 12; m++) {
      const monthEnd = new Date(paymentYear, m + 1, 0);
      const daysToEnd = Math.round((monthEnd - today) / 86400000);
      if (daysToEnd > 5) break; // months are chronological — later months are even further away
      const key = `${paymentYear}-${String(m + 1).padStart(2, '0')}`;
      const rec = db.monthlyPayments[item.id]?.[key];
      if (number(rec?.charged) - number(rec?.paid) > 0) {
        entries.push({ id: item.id, name: item.name, quarter: PAYMENT_QUARTERS[Math.floor(m / 3)].key });
        return;
      }
    }
  });
  return entries;
}

function alertNamesHtml(entries, section) {
  if (!entries.length) return '<span class="muted">Немає зауважень.</span>';
  const shown = entries.slice(0, 5).map((e) => `<button type="button" class="overview-link" data-alert-section="${section}" data-alert-client="${e.id}" data-alert-group="${esc(e.group || '')}" data-alert-period="${esc(e.period || '')}" data-alert-quarter="${esc(e.quarter || '')}">${esc(e.name)}</button>`).join(', ');
  const more = entries.length > 5 ? `, та інші (${entries.length - 5})` : '';
  return shown + more;
}

function overviewRow(title, entries, section, note) {
  return `<div class="overview-row">
    <div class="overview-row-head"><h2>${title}</h2><span class="pill ${entries.length ? 'late' : 'ok'}">${entries.length ? entries.length : 'OK'}</span></div>
    <div class="overview-row-body">${alertNamesHtml(entries, section)}${note ? `<span class="overview-row-note">${note}</span>` : ''}</div>
  </div>`;
}

function currentMonthsElapsed() {
  const now = new Date();
  if (now.getFullYear() < paymentYear) return 1;
  if (now.getFullYear() > paymentYear) return 12;
  return now.getMonth() + 1;
}
function incomeAlertEntries() {
  const monthsElapsed = currentMonthsElapsed();
  const monthIndexes = Array.from({ length: monthsElapsed }, (_, i) => i);
  const entries = [];
  db.clients.filter((item) => !item.archived && GROUP_MZP_MULTIPLIERS[item.group]).forEach((item) => {
    const ytd = incomeSum(item.id, monthIndexes);
    const avgMonthly = ytd / monthsElapsed;
    const remaining = groupLimitAmount(item.group) - ytd;
    if (remaining < avgMonthly * 3) entries.push({ id: item.id, name: item.name, group: String(item.group) === '3' ? '3' : '12' });
  });
  return entries;
}

function overviewView() {
  const kepAlerts = kepAlertEntries();
  const incomeAlerts = incomeAlertEntries();
  const taxAlerts = taxAlertEntries();
  const reportAlerts = reportAlertEntries();
  const serviceAlerts = serviceDebtAlertEntries();
  return `<div class="toolbar"><p class="note">Зведення зауважень по всіх розділах. Натисніть на ПІБ, щоб перейти до відповідного розділу й періоду.</p></div>
    ${overviewRow('КЕП закінчується:', kepAlerts, 'dashboard', 'КЕП спливає менш ніж за 3 дні')}
    ${overviewRow('Доходи', incomeAlerts, 'incomes', 'Залишок ліміту менший за 3 середньомісячних доходи')}
    ${overviewRow('Податки', taxAlerts, 'taxes', 'До дедлайну ≤ 5 днів, а сплати ще не було')}
    ${overviewRow('Звітність', reportAlerts, 'reports', 'До дедлайну ≤ 5 днів, а звіт ще не подано')}
    ${overviewRow('Оплати', serviceAlerts, 'payments', 'До кінця місяця ≤ 5 днів, а оплата послуг не закрита')}`;
}

function reportsView() {
  const groups = [{ key: '12', label: '1-2 група' }, { key: '3', label: '3 група' }];
  if (!groups.some((g) => g.key === reportGroup)) reportGroup = '12';
  const periods = reportPeriodsFor(reportGroup === '3' ? '3' : '1');
  if (!reportPeriod || !periods.some((p) => p.key === reportPeriod)) reportPeriod = periods[0].key;
  const clients = db.clients.filter((item) => !item.archived && (reportGroup === '3' ? String(item.group) === '3' : ['1', '2'].includes(String(item.group))));
  const rows = clients.map((item) => {
    const realGroup = String(item.group);
    const record = reportRecord(item.id, realGroup, reportPeriod);
    const deadline = record.deadline || getDefaultReportDeadline(realGroup, reportPeriod);
    const isDefaultDeadline = !record.deadline && Boolean(deadline);
    return `<tr data-row-id="${item.id}">
      <td class="fop-name-cell">${shortName(item)}</td>
      <td><input type="date" class="report-field" data-client="${item.id}" data-real-group="${realGroup}" data-field="submittedDate" value="${esc(record.submittedDate || '')}"></td>
      <td class="report-days">${daysUntilLabel(deadline, { paidDate: record.submittedDate })}</td>
      <td><input type="date" class="report-field ${isDefaultDeadline ? 'tax-field-default' : ''}" data-client="${item.id}" data-real-group="${realGroup}" data-field="deadline" value="${esc(deadline)}" title="${isDefaultDeadline ? 'Значення з «Налаштувань». Змініть, щоб задати виняток лише для цього ФОП.' : ''}"></td>
      <td class="report-status">${reportStatusPillHtml(record, deadline)}</td>
      <td><input type="text" class="report-field" data-client="${item.id}" data-real-group="${realGroup}" data-field="note" placeholder="Примітка" value="${esc(record.note || '')}"></td>
    </tr>`;
  });
  const groupTabs = groups.map((g) => `<button class="tab ${g.key === reportGroup ? 'active' : ''}" data-report-group="${g.key}">${g.label}</button>`).join('');
  const periodTabs = periods.map((p) => `<button class="tab ${p.key === reportPeriod ? 'active' : ''}" data-report-period="${p.key}">${p.label}</button>`).join('');
  const body = clients.length
    ? table(rows, ['ПІБ', 'Дата подання', 'Днів до дедлайну', 'Дедлайн', 'Статус', 'Примітка'])
    : empty('У цій групі ще немає активних ФОП.');
  return `<div class="toolbar"><p class="note">1-2 групи подають звіт раз на рік; 3 група — щоквартально. Дедлайни підставляються з «Налаштувань», якщо не вказано власного значення.</p></div>
    <div class="subnav">${groupTabs}</div>
    <div class="subnav periods">${periodTabs}</div>
    ${body}`;
}

function inactiveView() {
  const archived = db.clients.filter((item) => item.archived);
  const rows = archived.map((item) => `<tr>
    <td><strong>${shortName(item)}</strong></td>
    <td>${esc(item.group || '—')}</td>
    <td>${rateText(item)}</td>
    <td>${esc(item.inactiveReason || '—')}</td>
    <td class="right row-actions">
      <button class="secondary" data-restore-client="${item.id}">Активувати</button>
      <button class="icon" data-delete-client="${item.id}" title="Видалити безповоротно">🗑</button>
    </td>
  </tr>`);
  return `<div class="toolbar"><p class="note">ФОП, приховані з обліку. Усі дані збережено — активуйте, щоб рядок знову з'явився в «Огляді» та «Оплатах» на тому ж місці.</p></div>
    ${table(rows, ['ПІБ', 'Група', 'Ставка', 'Причина неактивності', 'Дії'])}`;
}

function taxes() {
  const groups = [{ key: '12', label: '1-2 група' }, { key: '3', label: '3 група' }];
  if (!groups.some((g) => g.key === taxGroup)) taxGroup = '12';
  const periods = taxPeriodsFor(taxGroup === '3' ? '3' : '1');
  if (!taxPeriod || !periods.some((p) => p.key === taxPeriod)) taxPeriod = periods[0].key;
  const clients = db.clients.filter((item) => !item.archived && (taxGroup === '3' ? String(item.group) === '3' : ['1', '2'].includes(String(item.group))));
  const rows = [];
  clients.forEach((item) => {
    const realGroup = String(item.group);
    TAX_TYPES.forEach((taxType, index) => {
      const record = taxRecord(item.id, realGroup, taxPeriod, taxType.key);
      const exempt = Boolean(record.exemption);
      const deadline = effectiveDeadline(realGroup, taxType.key, taxPeriod, record);
      const isDefaultDeadline = !record.deadline && Boolean(deadline);
      rows.push(`<tr class="${exempt ? 'exempt-row' : ''}" data-row-id="${item.id}">
        ${index === 0 ? `<td rowspan="3" class="fop-name-cell">${shortName(item)}</td>` : ''}
        <td>${taxType.label}</td>
        <td><input type="date" class="tax-field" data-client="${item.id}" data-real-group="${realGroup}" data-tax="${taxType.key}" data-field="queuedDate" value="${esc(record.queuedDate || '')}"></td>
        <td><input type="date" class="tax-field" data-client="${item.id}" data-real-group="${realGroup}" data-tax="${taxType.key}" data-field="paidDate" value="${esc(record.paidDate || '')}"></td>
        <td class="tax-days">${daysUntilLabel(deadline, record)}</td>
        <td><input type="date" class="tax-field ${isDefaultDeadline ? 'tax-field-default' : ''}" data-client="${item.id}" data-real-group="${realGroup}" data-tax="${taxType.key}" data-field="deadline" value="${esc(deadline)}" title="${isDefaultDeadline ? 'Значення з «Налаштувань». Змініть, щоб задати виняток лише для цього ФОП.' : ''}"></td>
        <td class="tax-status">${statusPillHtml(record, deadline)}</td>
        <td><select class="tax-field" data-client="${item.id}" data-real-group="${realGroup}" data-tax="${taxType.key}" data-field="exemption">${exemptionOptions(realGroup).map((opt) => `<option value="${esc(opt)}" ${record.exemption === opt ? 'selected' : ''}>${opt || '—'}</option>`).join('')}</select></td>
        <td><input type="text" class="tax-field" data-client="${item.id}" data-real-group="${realGroup}" data-tax="${taxType.key}" data-field="note" placeholder="Примітка" value="${esc(record.note || '')}"></td>
      </tr>`);
    });
  });
  const groupTabs = groups.map((g) => `<button class="tab ${g.key === taxGroup ? 'active' : ''}" data-tax-group="${g.key}">${g.label}</button>`).join('');
  const periodTabs = periods.map((p) => `<button class="tab ${p.key === taxPeriod ? 'active' : ''}" data-tax-period="${p.key}">${p.label}</button>`).join('');
  const body = clients.length
    ? table(rows, ['ПІБ', 'Податок', 'Набрано в банку', 'Дата сплати', 'Днів до дедлайну', 'Дедлайн', 'Статус', 'Причина звільнення', 'Примітка'], 'table tax-table')
    : empty('У цій групі ще немає активних ФОП.');
  return `<div class="toolbar"><p class="note">Дедлайни підставляються автоматично з «Налаштувань» (світлі поля). Змініть дедлайн вручну для конкретного ФОП, щоб задати виняток. Якщо у ФОП є причина звільнення, рядок стає сірим і статус не показується.</p></div>
    <div class="subnav">${groupTabs}</div>
    <div class="subnav periods">${periodTabs}</div>
    ${body}`;
}

function defaultPaymentsQuarter() {
  const now = new Date();
  const monthIndex = now.getFullYear() === paymentYear ? now.getMonth() : (now.getFullYear() < paymentYear ? 0 : 11);
  return PAYMENT_QUARTERS[Math.floor(monthIndex / 3)].key;
}
function payments() {
  if (!paymentsQuarter || !PAYMENT_QUARTERS.some((q) => q.key === paymentsQuarter)) paymentsQuarter = defaultPaymentsQuarter();
  const quarter = PAYMENT_QUARTERS.find((q) => q.key === paymentsQuarter);
  const months = quarter.months.map((index) => ({ key: `${paymentYear}-${String(index + 1).padStart(2, '0')}`, label: MONTH_NAMES_UA[index] }));
  const cells = (item, key, type) => {
    const value = db.monthlyPayments[item.id]?.[key]?.[type];
    return `<td><input class="month-value" inputmode="decimal" data-client="${item.id}" data-month="${key}" data-type="${type}" value="${esc(formatAmountDisplay(value))}" aria-label="${type} ${key} для ${esc(item.name)}"></td>`;
  };
  const rows = db.clients.filter((item) => !item.archived).map((item) => {
    // Totals always cover the whole year, regardless of which quarter tab is open.
    const monthly = db.monthlyPayments[item.id] || {};
    const totals = Object.values(monthly).reduce((acc, value) => ({ charged: acc.charged + number(value.charged), paid: acc.paid + number(value.paid) }), { charged: 0, paid: 0 });
    return `<tr data-row-id="${item.id}"><td class="fop-name"><strong>${shortName(item)}</strong></td><td class="right amount debt">${money.format(totals.charged - totals.paid)}</td>${months.map((month) => `${cells(item, month.key, 'charged')}${cells(item, month.key, 'paid')}`).join('')}</tr>`;
  });
  const quarterTabs = PAYMENT_QUARTERS.map((q) => `<button class="tab ${q.key === paymentsQuarter ? 'active' : ''}" data-payments-quarter="${q.key}">${q.label}</button>`).join('');
  return `<div class="toolbar"><p class="note">Для кожного ФОП — нараховано і сплачено по місяцях ${paymentYear} року. «Загальний борг» — за весь рік, незалежно від обраного кварталу. Вкажіть суму або «-». Зміни зберігаються після виходу з поля.</p></div>
    <div class="subnav">${quarterTabs}</div>
    <div class="table-wrap payments-matrix"><table class="table"><thead><tr><th rowspan="2" class="fop-name">ПІБ</th><th rowspan="2" class="debt">Загальний борг</th>${months.map((month) => `<th colspan="2" class="month-head">${month.label}</th>`).join('')}</tr><tr>${months.map(() => '<th>Нарах.</th><th>Сплач.</th>').join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${2 + months.length * 2}">${empty('Додайте ФОП на сторінці «Огляд».')}</td></tr>`}</tbody></table></div>`;
}


function monthlyDeadlineHalfRow(monthsSlice, offset) {
  const cells = monthsSlice.map((short, i) => {
    const index = offset + i;
    const key = `${paymentYear}-${String(index + 1).padStart(2, '0')}`;
    const value = db.settings.monthlyDeadlines[key] || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="monthly" data-period="${key}" value="${esc(value)}" aria-label="Дедлайн ${short}"></td>`;
  }).join('');
  const heads = monthsSlice.map((short) => `<th>${short}</th>`).join('');
  return `<table class="table settings-table"><thead><tr>${heads}</tr></thead><tbody><tr>${cells}</tr></tbody></table>`;
}
function monthlyDeadlineBlock() {
  return `<div class="settings-block">
    <p class="settings-block-label">Єдиний податок + Військовий збір (1-2 групи) — щомісячно</p>
    <div class="table-wrap">${monthlyDeadlineHalfRow(MONTH_SHORT_UA.slice(0, 6), 0)}</div>
    <div class="table-wrap" style="margin-top:4px">${monthlyDeadlineHalfRow(MONTH_SHORT_UA.slice(6, 12), 6)}</div>
  </div>`;
}
const SETTINGS_QUARTERS = [{ key: 'q1', label: 'I кв.' }, { key: 'half', label: 'II кв.' }, { key: '9m', label: 'III кв.' }, { key: 'year', label: 'IV кв.' }];
function quarterlyDeadlineRow(taxKey, label) {
  const store = db.settings.quarterlyDeadlines[taxKey];
  const cells = SETTINGS_QUARTERS.map((q) => {
    const value = store[q.key] || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="quarterly" data-tax="${taxKey}" data-period="${q.key}" value="${esc(value)}" aria-label="${label} ${q.label}"></td>`;
  }).join('');
  const heads = SETTINGS_QUARTERS.map((q) => `<th>${q.label}</th>`).join('');
  return `<div class="settings-block"><p class="settings-block-label">${label}</p><div class="table-wrap"><table class="table settings-table"><thead><tr>${heads}</tr></thead><tbody><tr>${cells}</tr></tbody></table></div></div>`;
}
function reportDeadlineBlock() {
  const annual = db.settings.reportDeadlines.annual || '';
  const quarterly = db.settings.reportDeadlines.quarterly;
  const qCells = SETTINGS_QUARTERS.map((q) => {
    const value = quarterly[q.key] || '';
    return `<td><input type="date" class="settings-field compact-date" data-scope="report-quarterly" data-period="${q.key}" value="${esc(value)}" aria-label="Звіт ${q.label}"></td>`;
  }).join('');
  const qHeads = SETTINGS_QUARTERS.map((q) => `<th>${q.label}</th>`).join('');
  return `<div class="panel settings-panel">
    <h2>Дедлайни звітності</h2>
    <div class="settings-block">
      <p class="settings-block-label">1-2 групи — раз на рік</p>
      <input type="date" class="settings-field compact-date" data-scope="report-annual" value="${esc(annual)}" aria-label="Річний дедлайн звітності 1-2 груп" style="max-width:150px">
    </div>
    <div class="settings-block">
      <p class="settings-block-label">3 група — поквартально</p>
      <div class="table-wrap"><table class="table settings-table"><thead><tr>${qHeads}</tr></thead><tbody><tr>${qCells}</tr></tbody></table></div>
    </div>
  </div>`;
}
function settingsView() {
  return `<div class="toolbar"><p class="note">Ці значення застосовуються автоматично: МЗП — до ліміту доходу у формі ФОП і в «Доходах»; дедлайни — до колонки «Дедлайн» у «Податках» і «Звітності» (якщо для конкретного запису не вказано власного значення).</p></div>
    <div class="panel settings-panel">
      <h2>Мінімальна заробітна плата (МЗП) — ${paymentYear}</h2>
      <label class="settings-mzp">грн/міс<input id="f_minWage" type="number" min="0" step="1" value="${number(db.settings.minWage)}"></label>
    </div>
    <div class="panel settings-panel">
      <h2>Дедлайни податків — 1-2 групи (щомісячно, єдиний спільний дедлайн)</h2>
      ${monthlyDeadlineBlock()}
    </div>
    <div class="panel settings-panel">
      <h2>Дедлайни податків — поквартально</h2>
      ${quarterlyDeadlineRow('group3', 'Єдиний податок + Військовий збір (3 група)')}
      ${quarterlyDeadlineRow('esv', 'ЄСВ (1, 2 і 3 групи)')}
    </div>
    ${reportDeadlineBlock()}`;
}

function incomeSum(clientId, monthIndexes) {
  return monthIndexes.reduce((sum, index) => {
    const key = `${paymentYear}-${String(index + 1).padStart(2, '0')}`;
    return sum + number(db.incomeRecords[clientId]?.[key]);
  }, 0);
}
function remainingLimitLabel(item, ytdIncome) {
  const limit = groupLimitAmount(item.group);
  if (!limit) return '—';
  const remaining = limit - ytdIncome;
  const cls = remaining < 0 ? 'late' : remaining < limit * 0.1 ? 'warn' : 'ok';
  return `<span class="pill ${cls}">${money.format(remaining)}</span>`;
}
function incomeCell(item, monthKey) {
  const value = db.incomeRecords[item.id]?.[monthKey];
  return `<td><input class="income-value" inputmode="decimal" data-client="${item.id}" data-month="${monthKey}" value="${esc(formatAmountDisplay(value))}" aria-label="Дохід ${monthKey} для ${esc(item.name)}"></td>`;
}
function updateIncomeRow(row, item) {
  const limitCell = row.querySelector('.income-limit-cell');
  if (incomeGroup === '12') {
    const ytd = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    if (limitCell) limitCell.innerHTML = remainingLimitLabel(item, ytd);
    return;
  }
  const sums = [incomeSum(item.id, [0, 1, 2]), incomeSum(item.id, [0, 1, 2, 3, 4, 5]), incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8]), incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])];
  if (limitCell) limitCell.innerHTML = remainingLimitLabel(item, sums[3]);
  row.querySelectorAll('.income-sum').forEach((cell, index) => { cell.textContent = money.format(sums[index]); });
}
function incomesView() {
  const groups = [{ key: '12', label: '1-2 група' }, { key: '3', label: '3 група' }];
  if (!groups.some((g) => g.key === incomeGroup)) incomeGroup = '12';
  const clients = db.clients.filter((item) => !item.archived && (incomeGroup === '12' ? ['1', '2'].includes(String(item.group)) : String(item.group) === '3'));
  const cell = (item, index) => incomeCell(item, `${paymentYear}-${String(index + 1).padStart(2, '0')}`);
  const sumCell = (value) => `<td class="right income-sum">${money.format(value)}</td>`;
  let headings, rows;
  if (incomeGroup === '12') {
    headings = ['ПІБ', 'Залишок ліміту', ...MONTH_SHORT_UA];
    rows = clients.map((item) => {
      const ytd = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const monthCells = Array.from({ length: 12 }, (_, index) => cell(item, index)).join('');
      return `<tr data-row-id="${item.id}"><td class="fop-name"><strong>${shortName(item)}</strong></td><td class="right income-limit-cell">${remainingLimitLabel(item, ytd)}</td>${monthCells}</tr>`;
    });
  } else {
    headings = ['ПІБ', 'Залишок ліміту', 'Січ', 'Лют', 'Бер', 'I кв.', 'Кві', 'Тра', 'Чер', 'Півріччя', 'Лип', 'Сер', 'Вер', '9 міс.', 'Жов', 'Лис', 'Гру', 'Рік'];
    rows = clients.map((item) => {
      const q1 = incomeSum(item.id, [0, 1, 2]);
      const half = incomeSum(item.id, [0, 1, 2, 3, 4, 5]);
      const m9 = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
      const yearTotal = incomeSum(item.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const line = `${cell(item, 0)}${cell(item, 1)}${cell(item, 2)}${sumCell(q1)}${cell(item, 3)}${cell(item, 4)}${cell(item, 5)}${sumCell(half)}${cell(item, 6)}${cell(item, 7)}${cell(item, 8)}${sumCell(m9)}${cell(item, 9)}${cell(item, 10)}${cell(item, 11)}${sumCell(yearTotal)}`;
      return `<tr data-row-id="${item.id}"><td class="fop-name"><strong>${shortName(item)}</strong></td><td class="right income-limit-cell">${remainingLimitLabel(item, yearTotal)}</td>${line}</tr>`;
    });
  }
  const groupTabs = groups.map((g) => `<button class="tab ${g.key === incomeGroup ? 'active' : ''}" data-income-group="${g.key}">${g.label}</button>`).join('');
  const headCells = headings.map((h, index) => `<th class="${index === 0 ? 'fop-name' : index === 1 ? 'income-limit-cell' : ''}">${h}</th>`).join('');
  const body = clients.length
    ? `<div class="table-wrap incomes-matrix"><table class="table"><thead><tr>${headCells}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : empty('У цій групі ще немає активних ФОП.');
  return `<div class="toolbar"><p class="note">Дохід за місяць вводьте вручну. Стовпці кварталу/півріччя/9 місяців/року рахуються автоматично. «Залишок ліміту» = ліміт групи (з «Налаштувань») мінус накопичений дохід з початку року.</p></div>
    <div class="subnav">${groupTabs}</div>
    ${body}`;
}

function openModal(title, body, saveHandler, dangerHtml = '') {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalDanger').innerHTML = dangerHtml;
  $('#modalErrors').innerHTML = '';
  onSave = saveHandler;
  $('#modal').showModal();
}

function closeModal() {
  onSave = null;
  $('#modalErrors').innerHTML = '';
  $('#modal').close();
}

function showClientForm(existing = {}) {
  const initialGroup = existing.group || '1';
  openModal(existing.id ? 'Редагувати ФОП' : 'Новий ФОП', `
    <label class="wide">ПІБ / назва ФОП<input id="f_name" value="${esc(existing.name)}" required></label>
    <label>Статус<select id="f_status"><option ${existing.status !== 'Не працюємо' ? 'selected' : ''}>Працюємо</option><option ${existing.status === 'Не працюємо' ? 'selected' : ''}>Не працюємо</option></select></label>
    <label>Група ЄП<select id="f_group">${['1','2','3','Загальна'].map((x) => `<option ${initialGroup === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Ставка ЄП<select id="f_rate"></select></label>
    <label>Ліміт доходу на рік (2026)<input id="f_limitDisplay" value="${groupLimitLabel(initialGroup)}" readonly></label>
    <label>Вартість обслуговування, грн<input id="f_serviceCost" type="number" value="${esc(existing.serviceCost || '')}"></label>
    <label>Дохід у валюті<select id="f_currency"><option>${esc(existing.currency || 'немає')}</option><option>немає</option><option>USD</option><option>EUR</option></select></label>
    <label>Телефон<textarea id="f_phone" placeholder="Кожен номер з нового рядка">${esc(existing.phone)}</textarea></label>
    <label>Ел. пошта<input id="f_email" type="email" value="${esc(existing.email)}"></label>
    <label>Зв'язок (Telegram)<input id="f_contactLink" type="text" placeholder="https://t.me/username" value="${esc(existing.contactLink)}"></label>
    <label>Доступ до банку<select id="f_bankAccess"><option>${esc(existing.bankAccess || '—')}</option><option>є</option><option>немає</option><option>частково</option></select></label>
    <label>П/РРО<select id="f_prro"><option>${esc(existing.prro || '—')}</option><option>є</option><option>немає</option></select></label>
    <label>Кількість найманих працівників<input id="f_employeesCount" type="number" min="0" step="1" value="${esc(existing.employeesCount || '')}"></label>
    <label>Видавець КЕП<input id="f_kepIssuer" value="${esc(existing.kepIssuer)}"></label>
    <label>КЕП дійсний до<input id="f_kepExpiry" type="date" value="${esc(existing.kepExpiry)}"></label>
    <label class="wide">ДПІ<input id="f_taxOffice" value="${esc(existing.taxOffice)}"></label>
    <label class="wide">Банківські рахунки<textarea id="f_banks">${esc(existing.banks)}</textarea></label>
    <label class="wide">Види діяльності (КВЕД)<textarea id="f_activities">${esc(existing.activities)}</textarea></label>
    ${customInputs(existing)}
  `, () => {
    const record = { ...existing, id: existing.id || uid(), form: 'ФОП' };
    ['name','status','group','rate','serviceCost','currency','phone','email','contactLink','bankAccess','prro','employeesCount','kepIssuer','kepExpiry','taxOffice','banks','activities'].forEach((key) => record[key] = input(key));
    record.customFields = { ...(existing.customFields || {}) };
    db.customColumns.forEach((column) => record.customFields[column.id] = input(`custom_${column.id}`));
    if (existing.id) {
      Object.assign(existing, record);
    } else {
      db.clients.push(record);
      db.monthlyPayments[record.id] = {};
    }
  }, existing.id ? `
    <p class="modal-danger-label">Небезпечна зона</p>
    <button type="button" class="secondary modal-danger-btn" data-modal-hide-client>🗄 Приховати ФОП</button>
    <button type="button" class="danger modal-danger-btn" data-modal-delete-client>🗑 Видалити ФОП назавжди</button>
  ` : '');
  if (existing.id) {
    $('[data-modal-hide-client]')?.addEventListener('click', () => {
      closeModal();
      openArchiveConfirmation(existing.id);
    });
    $('[data-modal-delete-client]')?.addEventListener('click', () => {
      closeModal();
      deleteClient(existing.id);
    });
  }
  const rateOptions = { '1': [{ value: '0.1', label: '10%' }], '2': [{ value: '0.2', label: '20%' }, { value: '0.15', label: '15%' }, { value: '0.1', label: '10%' }], '3': [{ value: '0.05', label: '5%' }, { value: '0.03', label: '3% + ПДВ' }], 'Загальна': [{ value: '', label: 'Не застосовується' }] };
  let selectedRate = existing.rate;
  const setRates = () => { const group = input('group'); const selected = selectedRate ?? rateOptions[group][0].value; $('#f_rate').innerHTML = rateOptions[group].map((item) => `<option value="${item.value}" ${String(item.value) === String(selected) ? 'selected' : ''}>${item.label}</option>`).join(''); };
  setRates();
  $('#f_group').addEventListener('change', () => { selectedRate = undefined; setRates(); $('#f_limitDisplay').value = groupLimitLabel(input('group')); });
}

function showColumnForm(existing = {}) {
  openModal(existing.id ? 'Змінити колонку' : 'Нова колонка', `
    <label class="wide">Назва колонки<input id="f_columnName" value="${esc(existing.name)}" required></label>
    <label>Тип даних<select id="f_columnType"><option value="text" ${existing.type === 'text' ? 'selected' : ''}>Текст</option><option value="number" ${existing.type === 'number' ? 'selected' : ''}>Число</option><option value="date" ${existing.type === 'date' ? 'selected' : ''}>Дата</option></select></label>
  `, () => {
    const column = { id: existing.id || uid(), name: input('columnName'), type: input('columnType') };
    if (existing.id) Object.assign(existing, column);
    else db.customColumns.push(column);
  });
}

const importColumns = [
  { header: 'ПІБ / назва ФОП', key: 'name' },
  { header: 'Статус', key: 'status' },
  { header: 'Група ЄП', key: 'group' },
  { header: 'Ставка ЄП (частка, напр. 0.05)', key: 'rate' },
  { header: 'Вартість обслуговування, грн', key: 'serviceCost' },
  { header: 'Валюта доходу', key: 'currency' },
  { header: 'Телефон', key: 'phone' },
  { header: 'Ел. пошта', key: 'email' },
  { header: 'Зв\'язок (Telegram)', key: 'contactLink' },
  { header: 'Доступ до банку', key: 'bankAccess' },
  { header: 'П/РРО', key: 'prro' },
  { header: 'Кількість найманих', key: 'employeesCount' },
  { header: 'ДПІ', key: 'taxOffice' },
  { header: 'Банківські рахунки', key: 'banks' },
  { header: 'Види діяльності (КВЕД)', key: 'activities' },
  { header: 'Видавець КЕП', key: 'kepIssuer' },
  { header: 'КЕП дійсний до (дата, РРРР-ММ-ДД)', key: 'kepExpiry' },
];

function exportClientsToExcel() {
  const headerRow = [...importColumns.map((column) => column.header), ...db.customColumns.map((column) => column.name)];
  const dataRows = db.clients.filter((item) => !item.archived).map((item) => [
    ...importColumns.map((column) => item[column.key] ?? ''),
    ...db.customColumns.map((column) => item.customFields?.[column.id] ?? ''),
  ]);
  if (!dataRows.length) {
    showAppToast('Немає ФОП для експорту.', 'error', 6000);
    return;
  }
  try {
    const sheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    sheet['!cols'] = headerRow.map(() => ({ wch: 26 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'ФОП');
    XLSX.writeFile(workbook, `fop-oblik-export-${dateToday()}.xlsx`);
    showAppToast('Експорт виконано успішно.', 'success', 4000);
  } catch (error) {
    console.error(error);
    showAppToast(error.message || 'Не вдалося виконати експорт.', 'error', 8000);
  }
}

function importClientsFromFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(event.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) { alert('Файл порожній або не містить рядків даних.'); return; }
      let created = 0, updated = 0, skipped = 0;
      rows.forEach((row) => {
        const name = String(row[importColumns[0].header] ?? '').trim();
        if (!name) { skipped++; return; }
        let record = db.clients.find((item) => item.name?.trim().toLowerCase() === name.toLowerCase());
        if (record) { updated++; } else {
          record = { id: uid(), form: 'ФОП', name, customFields: {} };
          db.clients.push(record);
          db.monthlyPayments[record.id] = {};
          created++;
        }
        record.name = name;
        importColumns.slice(1).forEach((column) => {
          const value = row[column.header];
          if (value !== undefined && String(value).trim() !== '') record[column.key] = String(value).trim();
        });
        record.customFields ||= {};
        db.customColumns.forEach((column) => {
          const value = row[column.name];
          if (value !== undefined && String(value).trim() !== '') record.customFields[column.id] = String(value).trim();
        });
      });
      persist(); render();
      alert(`Імпорт завершено.\nНових ФОП: ${created}\nОновлено: ${updated}${skipped ? `\nПропущено рядків без ПІБ: ${skipped}` : ''}`);
    } catch (err) {
      console.error(err);
      alert('Не вдалося прочитати файл. Перевірте, що це коректний .xlsx/.xls/.csv зі структурою колонок як у прикладі.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function setupTopScrollbars() {
  document.querySelectorAll('#content .table-wrap').forEach((wrap) => {
    const table = wrap.querySelector('table');
    if (!table) return;
    let bar = wrap.previousElementSibling;
    if (!bar || !bar.classList.contains('top-scrollbar')) {
      bar = document.createElement('div');
      bar.className = 'top-scrollbar';
      bar.innerHTML = '<div class="top-scrollbar-inner"></div>';
      wrap.parentNode.insertBefore(bar, wrap);
    }
    const needsScroll = table.scrollWidth > wrap.clientWidth + 1;
    bar.style.display = needsScroll ? 'block' : 'none';
    if (!needsScroll) return;
    bar.style.width = `${wrap.clientWidth}px`;
    bar.querySelector('.top-scrollbar-inner').style.width = `${table.scrollWidth}px`;
    if (!bar.dataset.bound) {
      bar.addEventListener('scroll', () => { wrap.scrollLeft = bar.scrollLeft; });
      wrap.addEventListener('scroll', () => { bar.scrollLeft = wrap.scrollLeft; });
      bar.dataset.bound = '1';
    }
    bar.scrollLeft = wrap.scrollLeft;
  });
}
window.addEventListener('resize', () => setupTopScrollbars());

function deleteClient(id) {
  const item = client(id);
  if (!item) return;
  if (!confirm(`Видалити ФОП «${item.name}» назавжди? Рядок і всі дані буде стерто з усіх таблиць і вкладок без можливості відновлення.`)) return;
  db.clients = db.clients.filter((c) => c.id !== id);
  delete db.monthlyPayments[id];
  persist(); render();
}

function setArchived(id, archived, reason = '') {
  const item = client(id);
  if (!item) return;
  item.archived = archived;
  item.inactiveReason = archived ? reason : '';
  persist(); render();
}

function reorderClients(sourceId, targetId) {
  const fromIndex = db.clients.findIndex((item) => item.id === sourceId);
  const toIndex = db.clients.findIndex((item) => item.id === targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
  const [moved] = db.clients.splice(fromIndex, 1);
  db.clients.splice(toIndex, 0, moved);
  persist(); render();
}

function updateRowDebt(row, clientId) {
  const totals = Object.values(db.monthlyPayments[clientId] || {}).reduce((acc, value) => ({ charged: acc.charged + number(value.charged), paid: acc.paid + number(value.paid) }), { charged: 0, paid: 0 });
  row.querySelector('.debt').textContent = money.format(totals.charged - totals.paid);
}

function bindCurrentView() {
  document.querySelectorAll('[data-edit-client]').forEach((button) => button.onclick = () => openClientCard(button.dataset.editClient));
  document.querySelectorAll('[data-open-card]').forEach((button) => button.onclick = () => openClientCard(button.dataset.openCard));
  document.querySelectorAll('[data-hide-client]').forEach((button) => button.onclick = () => {
    const item = client(button.dataset.hideClient);
    if (!item) return;
    openArchiveConfirmation(item.id);
  });
  document.querySelectorAll('[data-restore-client]').forEach((button) => button.onclick = () => setArchived(button.dataset.restoreClient, false));
  document.querySelectorAll('[data-delete-client]').forEach((button) => button.onclick = () => deleteClient(button.dataset.deleteClient));
  let dragSourceId = null;
  document.querySelectorAll('tr[draggable="true"]').forEach((row) => {
    row.addEventListener('dragstart', () => { dragSourceId = row.dataset.rowId; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragSourceId = null; });
    row.addEventListener('dragover', (event) => { event.preventDefault(); });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!dragSourceId || dragSourceId === row.dataset.rowId) return;
      reorderClients(dragSourceId, row.dataset.rowId);
    });
  });
  document.querySelectorAll('[data-payments-quarter]').forEach((button) => button.onclick = () => { paymentsQuarter = button.dataset.paymentsQuarter; render(); });
  document.querySelectorAll('[data-alert-section]').forEach((button) => button.onclick = () => {
    const section = button.dataset.alertSection;
    if (section === 'dashboard') view = 'dashboard';
    else if (section === 'taxes') { view = 'taxes'; taxGroup = button.dataset.alertGroup; taxPeriod = button.dataset.alertPeriod; }
    else if (section === 'reports') { view = 'reports'; reportGroup = button.dataset.alertGroup; reportPeriod = button.dataset.alertPeriod; }
    else if (section === 'payments') { view = 'payments'; paymentsQuarter = button.dataset.alertQuarter; }
    else if (section === 'incomes') { view = 'incomes'; incomeGroup = button.dataset.alertGroup; }
    pendingHighlightClientId = button.dataset.alertClient;
    document.querySelectorAll('#nav button').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    render();
  });
  document.querySelectorAll('[data-tax-group]').forEach((button) => button.onclick = () => { taxGroup = button.dataset.taxGroup; taxPeriod = null; render(); });
  document.querySelectorAll('[data-tax-period]').forEach((button) => button.onclick = () => { taxPeriod = button.dataset.taxPeriod; render(); });
  document.querySelectorAll('[data-report-group]').forEach((button) => button.onclick = () => { reportGroup = button.dataset.reportGroup; reportPeriod = null; render(); });
  document.querySelectorAll('[data-report-period]').forEach((button) => button.onclick = () => { reportPeriod = button.dataset.reportPeriod; render(); });
  document.querySelectorAll('.report-field').forEach((field) => field.addEventListener('change', () => {
    const realGroup = field.dataset.realGroup;
    const record = reportRecord(field.dataset.client, realGroup, reportPeriod);
    record[field.dataset.field] = field.value;
    persist();
    const row = field.closest('tr');
    const deadline = record.deadline || getDefaultReportDeadline(realGroup, reportPeriod);
    const isDefaultDeadline = !record.deadline && Boolean(deadline);
    const daysCell = row.querySelector('.report-days');
    if (daysCell) daysCell.innerHTML = daysUntilLabel(deadline, { paidDate: record.submittedDate });
    const statusCell = row.querySelector('.report-status');
    if (statusCell) statusCell.innerHTML = reportStatusPillHtml(record, deadline);
    const deadlineField = row.querySelector('[data-field="deadline"]');
    if (deadlineField) {
      deadlineField.classList.toggle('tax-field-default', isDefaultDeadline);
      if (field.dataset.field !== 'deadline') deadlineField.value = deadline;
    }
  }));
  document.querySelectorAll('.tax-field').forEach((field) => field.addEventListener('change', () => {
    const realGroup = field.dataset.realGroup;
    const record = taxRecord(field.dataset.client, realGroup, taxPeriod, field.dataset.tax);
    record[field.dataset.field] = field.value;
    persist();
    const row = field.closest('tr');
    row.classList.toggle('exempt-row', Boolean(record.exemption));
    const deadline = effectiveDeadline(realGroup, field.dataset.tax, taxPeriod, record);
    const isDefaultDeadline = !record.deadline && Boolean(deadline);
    const daysCell = row.querySelector('.tax-days');
    if (daysCell) daysCell.innerHTML = daysUntilLabel(deadline, record);
    const statusCell = row.querySelector('.tax-status');
    if (statusCell) statusCell.innerHTML = statusPillHtml(record, deadline);
    const deadlineField = row.querySelector('[data-field="deadline"]');
    if (deadlineField) {
      deadlineField.classList.toggle('tax-field-default', isDefaultDeadline);
      deadlineField.title = isDefaultDeadline ? 'Значення з «Налаштувань». Змініть, щоб задати виняток лише для цього ФОП.' : '';
      if (field.dataset.field !== 'deadline') deadlineField.value = deadline;
    }
  }));
  $('[data-export-clients]')?.addEventListener('click', exportClientsToExcel);
  $('[data-import-clients]')?.addEventListener('click', () => $('#importFile')?.click());
  $('#importFile')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) importClientsFromFile(file);
    event.target.value = '';
  });
  $('[data-add-column]')?.addEventListener('click', () => showColumnForm());
  document.querySelectorAll('[data-edit-column]').forEach((button) => button.onclick = () => showColumnForm(db.customColumns.find((column) => column.id === button.dataset.editColumn)));
  document.querySelectorAll('[data-delete-column]').forEach((button) => button.onclick = () => {
    const column = db.customColumns.find((item) => item.id === button.dataset.deleteColumn);
    if (!column || !confirm(`Видалити колонку «${column.name}»? Значення у ФОП буде втрачено.`)) return;
    db.customColumns = db.customColumns.filter((item) => item.id !== column.id);
    db.clients.forEach((item) => { if (item.customFields) delete item.customFields[column.id]; });
    persist(); render();
  });
  document.querySelectorAll('.custom-cell').forEach((field) => field.addEventListener('change', () => {
    const item = client(field.dataset.client);
    if (!item) return;
    item.customFields ||= {};
    item.customFields[field.dataset.column] = field.value.trim();
    persist();
  }));
  document.querySelectorAll('.month-value').forEach((field) => field.addEventListener('change', () => {
    const parsed = parseAmountInput(field.value);
    if (parsed === null) { field.value = ''; return; }
    const clientData = db.monthlyPayments[field.dataset.client] ||= {};
    const monthData = clientData[field.dataset.month] ||= {};
    monthData[field.dataset.type] = parsed;
    field.value = formatAmountDisplay(parsed);
    persist(); updateRowDebt(field.closest('tr'), field.dataset.client);
  }));
  $('#f_minWage')?.addEventListener('change', () => {
    db.settings.minWage = number($('#f_minWage').value);
    persist();
  });
  document.querySelectorAll('.settings-field').forEach((field) => field.addEventListener('change', () => {
    if (field.dataset.scope === 'monthly') db.settings.monthlyDeadlines[field.dataset.period] = field.value;
    else if (field.dataset.scope === 'quarterly') db.settings.quarterlyDeadlines[field.dataset.tax][field.dataset.period] = field.value;
    else if (field.dataset.scope === 'report-annual') db.settings.reportDeadlines.annual = field.value;
    else if (field.dataset.scope === 'report-quarterly') db.settings.reportDeadlines.quarterly[field.dataset.period] = field.value;
    persist();
  }));
  document.querySelectorAll('[data-income-group]').forEach((button) => button.onclick = () => { incomeGroup = button.dataset.incomeGroup; render(); });
  document.querySelectorAll('.income-value').forEach((field) => field.addEventListener('change', () => {
    const parsed = parseAmountInput(field.value);
    if (parsed === null) { field.value = ''; return; }
    const clientData = db.incomeRecords[field.dataset.client] ||= {};
    clientData[field.dataset.month] = parsed;
    field.value = formatAmountDisplay(parsed);
    persist();
    const item = client(field.dataset.client);
    if (item) updateIncomeRow(field.closest('tr'), item);
  }));
}

$('#quickAdd').addEventListener('click', () => openClientCard(null));
$('#nav').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (!['overview', 'dashboard', 'payments', 'taxes', 'incomes', 'reports', 'inactive', 'settings'].includes(button.dataset.view)) return;
  view = button.dataset.view;
  document.querySelectorAll('#nav button').forEach((item) => item.classList.toggle('active', item === button));
  render();
});
$('#modalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!$('#modalForm').reportValidity()) return;
  const result = onSave?.();
  if (result === false) return;
  persist(); closeModal(); render();
});
$('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) closeModal(); });
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `fop-oblik-${dateToday()}.json`; link.click(); URL.revokeObjectURL(link.href);
});
boot();
