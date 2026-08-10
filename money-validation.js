import { normalizeNumberInput } from './utils.js';

export const MAX_MONEY_AMOUNT = 999_999_999_999.99;

/** Normalize a user-entered amount while rejecting values that corrupt totals. */
export function normalizeNonNegativeAmount(rawValue, { allowDash = false } = {}) {
  const normalized = normalizeNumberInput(rawValue);
  if (allowDash && normalized === '-') return { ok: true, value: '-' };
  if (normalized === '') return { ok: true, value: '' };
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_MONEY_AMOUNT) {
    return { ok: false, value: '' };
  }
  return { ok: true, value: normalized };
}

/** Format a persisted canonical amount for editable money fields. */
export function formatEditableAmount(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '' || rawValue === '-') return '';
  const amount = normalizeNonNegativeAmount(rawValue);
  if (!amount.ok || amount.value === '') return '';
  return Number(amount.value).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
}
