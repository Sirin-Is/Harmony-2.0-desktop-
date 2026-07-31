// utils.js
// Small, pure, dependency-free helpers used across the whole app.
// Nothing here touches localStorage or the DOM structure of a specific view.

export const DEFAULT_WORKING_YEAR = 2026;
export const PAYMENT_YEAR = DEFAULT_WORKING_YEAR;

export function monthPeriodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function normalizeWorkingYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : DEFAULT_WORKING_YEAR;
}

export const MONTH_NAMES_UA = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];
export const MONTH_SHORT_UA = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

export const moneyFormat = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 0 });
export const dateFormat = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' });

/** Shorthand querySelector, scoped to document by default. */
export const $ = (selector, root = document) => root.querySelector(selector);
/** Shorthand querySelectorAll returning a real array (easier to map/filter). */
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Escape a value for safe interpolation into innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** Coerce any input into a finite number, defaulting to 0. */
export function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** Today's date as YYYY-MM-DD (matches <input type="date"> value format). */
export function todayIso() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Generate a v4 UUID for new records. Falls back if crypto.randomUUID is unavailable. */
export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Difference in whole days between today (local midnight) and an ISO date string.
 * Returns null when dateStr is empty/invalid so callers can render a placeholder.
 */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function daysBetween(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return null;
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Debounce: delay calling fn until `wait` ms after the last invocation. */
export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Read the trimmed value of a form field by its `f_` id prefix (used inside modals). */
export function fieldValue(id) {
  return document.getElementById(`f_${id}`)?.value.trim() ?? '';
}

/** Simple, permissive e-mail check — good enough to catch typos, not RFC-perfect validation. */
export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
