// tax-model.ts
// Business logic for the "Податки" module. Pure functions only, operating
// on a passed-in db. Поведінка ідентична tax-model.js.

import { DEFAULT_WORKING_YEAR, MONTH_NAMES_UA, monthPeriodKey, daysUntil, daysBetween } from './utils.ts';
import type { Database, TaxRecord } from './types';

export interface TaxType { key: string; label: string }
export interface Period { key: string; label: string }
export interface TabGroup { key: string; label: string }

export const TAX_TYPES: TaxType[] = [
  { key: 'unified', label: 'Єдиний податок' },
  { key: 'military', label: 'Військовий збір' },
  { key: 'esv', label: 'ЄСВ' },
];

// Вкладки в UI: 1 і 2 групи мають однакові дедлайни й показані разом.
export const TAX_GROUPS: TabGroup[] = [
  { key: '12', label: '1-2 група' },
  { key: '3', label: '3 група' },
];

/** Groups 1 & 2 report monthly; group 3 reports cumulatively (quarter / half-year / 9 months / year). */
export function taxPeriodsFor(group: string, workingYear = DEFAULT_WORKING_YEAR): Period[] {
  if (group === '3') {
    return [
      { key: `${workingYear}-q1`, label: '1 квартал' },
      { key: `${workingYear}-half`, label: 'Півріччя' },
      { key: `${workingYear}-9m`, label: '9 місяців' },
      { key: `${workingYear}-year`, label: 'Рік' },
    ];
  }
  return Array.from({ length: 12 }, (_, index) => ({
    key: monthPeriodKey(workingYear, index + 1),
    label: MONTH_NAMES_UA[index],
  }));
}

/** Which calendar quarter (q1/half/9m/year) a monthly period key falls into — used by ЄСВ's quarterly deadline. */
export function quarterKeyForPeriod(periodKey: string): string {
  if (/^\d{4}-(q1|half|9m|year)$/.test(periodKey)) return periodKey.slice(5);
  const month = Number(periodKey.slice(5, 7)) - 1;
  return ['q1', 'q1', 'q1', 'half', 'half', 'half', '9m', '9m', '9m', 'year', 'year', 'year'][month];
}

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fromIso = (value: string) => new Date(`${value}T00:00:00`);
/** Internal control date: if the statutory day is on a weekend, work on the preceding Friday. */
export function controlDeadline(statutoryDate: string): string {
  const date = fromIso(statutoryDate); const day = date.getDay();
  if (day === 6) date.setDate(date.getDate() - 1);
  if (day === 0) date.setDate(date.getDate() - 2);
  return iso(date);
}
export function quarterEnd(periodKey: string): Date {
  const year = Number(periodKey.slice(0, 4)); const key = quarterKeyForPeriod(periodKey);
  const month = key === 'q1' ? 2 : key === 'half' ? 5 : key === '9m' ? 8 : 11;
  return new Date(year, month + 1, 0);
}

/** Deterministic internal deadline for the tax-control workflow. */
export function calculatedTaxDeadline(realGroup: string, taxType: string, periodKey: string): string {
  if (taxType === 'esv') { const end = quarterEnd(realGroup === '3' ? periodKey : `${periodKey.slice(0, 4)}-${quarterKeyForPeriod(periodKey)}`); end.setDate(end.getDate() + 20); return controlDeadline(iso(end)); }
  if (realGroup === '3') { const end = quarterEnd(periodKey); end.setDate(end.getDate() + 50); return controlDeadline(iso(end)); }
  return controlDeadline(`${periodKey}-20`);
}

/** "не було доходів" only makes sense for group 3 (income-based tax); other reasons apply to any group. */
export function exemptionOptions(group: string): string[] {
  const options = ['', 'працевлаштування', 'пенсія', 'ТМБД'];
  if (group === '3') options.splice(3, 0, 'не було доходів');
  return options;
}

/** Given an ordered periods list, return the key right before `currentKey`, or null if it's the first. */
export function previousPeriodKey(periods: Period[], currentKey: string | null): string | null {
  const index = periods.findIndex((p) => p.key === currentKey);
  return index > 0 ? periods[index - 1].key : null;
}

function taxRecordKey(clientId: string, realGroup: string, period: string, taxType: string): string {
  return `${clientId}|${realGroup}|${period}|${taxType}`;
}

/** Get (creating if absent) the mutable tax record for a given client/real-group('1'|'2'|'3')/period/tax type. */
export function getTaxRecord(db: Database, clientId: string, realGroup: string, period: string, taxType: string): TaxRecord {
  const key = taxRecordKey(clientId, realGroup, period, taxType);
  // Prior to the Period setting, 3rd-group periods had no year. Treat those
  // legacy records as 2026 data once, so existing work is never hidden.
  if (!db.taxRecords[key] && period.startsWith(`${DEFAULT_WORKING_YEAR}-`)) {
    const legacyPeriod = period.slice(5);
    const legacy = db.taxRecords[taxRecordKey(clientId, realGroup, legacyPeriod, taxType)];
    if (legacy) db.taxRecords[key] = { ...legacy };
  }
  return db.taxRecords[key] ||= {};
}

/** The deadline configured in "Налаштування" for this real group/tax/period, before any per-record override. */
export function getDefaultDeadline(db: Database, realGroup: string, taxType: string, periodKey: string): string {
  return calculatedTaxDeadline(realGroup, taxType, periodKey);
}

/** A record's own explicit deadline wins; otherwise fall back to the Settings-wide default. */
export function effectiveDeadline(db: Database, realGroup: string, taxType: string, periodKey: string, record: TaxRecord): string {
  return record.deadline || getDefaultDeadline(db, realGroup, taxType, periodKey);
}

export interface TaxStatus { text: string; cls: 'ok' | 'warn' | 'late' | 'neutral' }

/**
 * Derive a record's status from its dates, or null when an exemption reason is set
 * (callers should render that as a blank/dash and gray out the row).
 */
export function taxStatus(record: TaxRecord, deadline?: string): TaxStatus | null {
  if (record.exemption) return null;
  const effective = deadline ?? record.deadline;
  if (record.paidDate) {
    if (effective && record.paidDate > effective) return { text: 'Невчасно', cls: 'late' };
    return { text: 'Вчасно', cls: 'ok' };
  }
  if (record.queuedDate) return { text: 'Очікуємо на сплату', cls: 'warn' };
  return { text: 'Набери платіжку', cls: 'neutral' };
}

export function statusPillHtml(record: TaxRecord, deadline?: string): string {
  if (record.exemption) return '-';
  const status = taxStatus(record, deadline);
  return status ? `<span class="pill ${status.cls}">${status.text}</span>` : '-';
}

/**
 * Days remaining until a tax deadline. Once actually paid (record.paidDate
 * set), the count FREEZES as of that payment date instead of ticking
 * relative to today — it becomes a permanent record of "how early/late
 * was this paid".
 */
export function daysUntilLabel(deadline: string | undefined, record: TaxRecord): string {
  if (!deadline) return '-';
  const paidDate = record?.paidDate;
  const diff = paidDate ? daysBetween(paidDate, deadline) : daysUntil(deadline);
  if (diff === null) return '-';
  if (diff < 0) return `<span class="pill late">${diff} дн.</span>`;
  if (!paidDate && diff <= 7) return `<span class="pill warn">${diff} дн.</span>`;
  return `<span class="pill ok">${diff} дн.</span>`;
}
