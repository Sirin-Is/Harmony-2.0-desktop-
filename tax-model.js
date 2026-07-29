// tax-model.js
// Business logic for the "Податки" module: which periods exist per group,
// which exemption reasons apply, and how a tax record's status is derived.
// Pure functions only, operating on a passed-in db.

import { MONTH_NAMES_UA, PAYMENT_YEAR, daysUntil } from './utils.js';

export const TAX_TYPES = [
  { key: 'unified', label: 'Єдиний податок' },
  { key: 'military', label: 'Військовий збір' },
  { key: 'esv', label: 'ЄСВ' },
];

export const TAX_GROUPS = [
  { key: '1', label: '1 група' },
  { key: '2', label: '2 група' },
  { key: '3', label: '3 група' },
];

/** Groups 1 & 2 report monthly; group 3 reports cumulatively (quarter / half-year / 9 months / year). */
export function taxPeriodsFor(group) {
  if (group === '3') {
    return [
      { key: 'q1', label: '1 квартал' },
      { key: 'half', label: 'Півріччя' },
      { key: '9m', label: '9 місяців' },
      { key: 'year', label: 'Рік' },
    ];
  }
  return Array.from({ length: 12 }, (_, index) => ({
    key: `${PAYMENT_YEAR}-${String(index + 1).padStart(2, '0')}`,
    label: MONTH_NAMES_UA[index],
  }));
}

/** "не було доходів" only makes sense for group 3 (income-based tax); other reasons apply to any group. */
export function exemptionOptions(group) {
  const options = ['', 'працевлаштування', 'пенсія', 'ТМБД'];
  if (group === '3') options.splice(3, 0, 'не було доходів');
  return options;
}

/** Given an ordered periods list, return the key right before `currentKey`, or null if it's the first. */
export function previousPeriodKey(periods, currentKey) {
  const index = periods.findIndex((p) => p.key === currentKey);
  return index > 0 ? periods[index - 1].key : null;
}

/**
 * Якщо дата припадає на суботу або неділю, повертає попередню п'ятницю.
 */
function getPreviousWorkday(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay(); // 0 — неділя, 6 — субота

  if (dayOfWeek === 0) {
    date.setDate(date.getDate() - 2); // Зсув з неділі на п'ятницю
  } else if (dayOfWeek === 6) {
    date.setDate(date.getDate() - 1); // Зсув із суботи на п'ятницю
  }

  return date.toISOString().split('T')[0];
}

/**
 * Автоматичний розрахунок дедлайну з урахуванням вихідних днів (зсув на п'ятницю).
 */
export function getDefaultDeadline(group, period, taxType) {
  const currentYear = PAYMENT_YEAR || new Date().getFullYear();
  let rawDeadline = '';

  if (group === '1' || group === '2') {
    const [year, month] = period.split('-').map(Number);

    if (taxType === 'esv') {
      const quarterEndMonths = [3, 6, 9, 12];
      const quarterEndMonth = quarterEndMonths.find((m) => m >= month) || 12;

      let nextMonth = quarterEndMonth + 1;
      let targetYear = year;
      if (nextMonth > 12) {
        nextMonth = 1;
        targetYear += 1;
      }
      rawDeadline = `${targetYear}-${String(nextMonth).padStart(2, '0')}-20`;
    } else {
      rawDeadline = `${year}-${String(month).padStart(2, '0')}-20`;
    }
  }

  if (group === '3') {
    const quarterDeadlines = {
      'q1':   { default: `${currentYear}-05-20`, esv: `${currentYear}-04-20` },
      'half': { default: `${currentYear}-08-19`, esv: `${currentYear}-07-20` },
      '9m':   { default: `${currentYear}-11-19`, esv: `${currentYear}-10-20` },
      'year': { default: `${currentYear + 1}-02-19`, esv: `${currentYear + 1}-01-20` },
    };

    const config = quarterDeadlines[period];
    if (config) {
      rawDeadline = taxType === 'esv' ? config.esv : config.default;
    }
  }

  return rawDeadline ? getPreviousWorkday(rawDeadline) : '';
}

function taxRecordKey(clientId, group, period, taxType) {
  return `${clientId}|${group}|${period}|${taxType}`;
}

/** Get (creating if absent) the mutable tax record for a given client/group/period/tax type. */
export function getTaxRecord(db, clientId, group, period, taxType) {
  const key = taxRecordKey(clientId, group, period, taxType);
  
  // 1. Створюємо запис, якщо його взагалі немає в базі
  if (!db.taxRecords[key]) {
    db.taxRecords[key] = {};
  }

  const record = db.taxRecords[key];

  // 2. Якщо поле deadline відсутнє, null або є порожнім рядком "" — автозаповнюємо його
  if (!record.deadline || typeof record.deadline !== 'string' || record.deadline.trim() === '') {
    record.deadline = getDefaultDeadline(group, period, taxType);
  }

  return record;
}

/**
 * Derive a record's status from its dates, or null when an exemption reason is set
 * (callers should render that as a blank/dash and gray out the row).
 */
export function taxStatus(record) {
  if (record.exemption) return null;
  if (record.paidDate) {
    if (record.deadline && record.paidDate > record.deadline) return { text: 'Невчасно', cls: 'late' };
    return { text: 'Вчасно', cls: 'ok' };
  }
  if (record.queuedDate) return { text: 'Очікуємо на сплату', cls: 'warn' };
  return { text: 'Набери платіжку', cls: 'neutral' };
}

export function statusPillHtml(record) {
  const status = taxStatus(record);
  return status ? `<span class="pill ${status.cls}">${status.text}</span>` : '—';
}

/** Days remaining until a tax deadline, styled like the KEP countdown but with a 7-day (not 30-day) warning threshold. */
export function daysUntilLabel(dateStr) {
  const diff = daysUntil(dateStr);
  if (diff === null) return '—';
  if (diff < 0) return `<span class="pill late">${diff} дн.</span>`;
  if (diff <= 7) return `<span class="pill warn">${diff} дн.</span>`;
  return `<span class="pill ok">${diff} дн.</span>`;
}
