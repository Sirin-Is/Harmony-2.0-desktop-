const MONTH_NAMES_GENITIVE_UA = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

const pad = (value) => String(value).padStart(2, '0');
const validPeriod = (period) => /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period || ''));

function previousWorkday(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getDay() === 6) date.setDate(date.getDate() - 1);
  if (date.getDay() === 0) date.setDate(date.getDate() - 2);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultPayrollDates(period) {
  const match = validPeriod(period);
  if (!match) return { secondHalf: '', firstHalf: '' };
  const year = Number(match[1]); const month = Number(match[2]);
  return { secondHalf: previousWorkday(year, month, 7), firstHalf: previousWorkday(year, month, 22) };
}

// Зарплатний графік є єдиним для всіх місяців: 7 і 22 число.
// Збережені у старих версіях помісячні винятки навмисно ігноруються.
export function payrollDatesForPeriod(_settings, period) { return defaultPayrollDates(period); }

export function payrollPartForPaymentType(paymentType) {
  const label = String(paymentType || '').toLowerCase();
  if (label.includes('за другу половину')) return 'secondHalf';
  if (label.includes('за першу половину')) return 'firstHalf';
  return '';
}

export function payrollDateForPaymentType(settings, period, paymentType) {
  const part = payrollPartForPaymentType(paymentType);
  return part ? payrollDatesForPeriod(settings, period)[part] : '';
}

/** Labels are derived exclusively from the period in which the payroll row is created. */
export function payrollPaymentTypes(period) {
  const match = validPeriod(period);
  if (!match) return [];
  const month = Number(match[2]);
  const previousMonth = MONTH_NAMES_GENITIVE_UA[month === 1 ? 11 : month - 2];
  const currentMonth = MONTH_NAMES_GENITIVE_UA[month - 1];
  return [
    `Виплата ЗП за другу половину ${previousMonth}`,
    `Виплата ЗП за першу половину ${currentMonth}`,
    'Звільнення', 'Відпустка', 'Лікарняні',
  ];
}
