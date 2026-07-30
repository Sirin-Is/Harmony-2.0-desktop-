// utils.ts
// Small, pure, dependency-free helpers used across the whole app.
// Поведінка ідентична utils.js — додано лише типи.

/** First working year used by the app before the configurable Period setting. */
export const DEFAULT_WORKING_YEAR = 2026;

export interface MonthPeriod {
  year: number;
  month: number;
}

/** Stable storage key for a calendar month, e.g. "2026-01". */
export function monthPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Guards the persisted working year against malformed older data. */
export function normalizeWorkingYear(value: unknown): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : DEFAULT_WORKING_YEAR;
}

export const MONTH_NAMES_UA: string[] = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

export const MONTH_SHORT_UA: string[] = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

export const moneyFormat = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 0 });
export const dateFormat = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' });

/** Shorthand querySelector, scoped to document by default. */
export const $ = <T extends Element = Element>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);
/** Shorthand querySelectorAll returning a real array (easier to map/filter). */
export const $$ = <T extends Element = Element>(selector: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(selector));

/** Escape a value for safe interpolation into innerHTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] as string));
}

/** Coerce any input into a finite number, defaulting to 0. */
export function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** Today's date as YYYY-MM-DD (matches <input type="date"> value format). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Generate a v4 UUID for new records. Falls back if crypto.randomUUID is unavailable. */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Difference in whole days between today (local midnight) and an ISO date string.
 * Returns null when dateStr is empty/invalid so callers can render a placeholder.
 */
export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** Difference in whole days between two ISO date strings (fromDate -> toDate). */
export function daysBetween(fromDateStr?: string | null, toDateStr?: string | null): number | null {
  if (!fromDateStr || !toDateStr) return null;
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Debounce: delay calling fn until `wait` ms after the last invocation. */
export function debounce<T extends (...args: any[]) => void>(fn: T, wait = 300): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Read the trimmed value of a form field by its `f_` id prefix (used inside modals). */
export function fieldValue(id: string): string {
  return (document.getElementById(`f_${id}`) as HTMLInputElement | null)?.value.trim() ?? '';
}

/** Simple, permissive e-mail check — good enough to catch typos, not RFC-perfect validation. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
