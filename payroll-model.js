const MONTH_NAMES_GENITIVE_UA = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

/** Labels are derived exclusively from the period in which the payroll row is created. */
export function payrollPaymentTypes(period) {
  const match = String(period || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return [];
  const month = Number(match[2]);
  const previousMonth = MONTH_NAMES_GENITIVE_UA[month === 1 ? 11 : month - 2];
  const currentMonth = MONTH_NAMES_GENITIVE_UA[month - 1];
  return [
    `Виплата зарплати за другу половину ${previousMonth}`,
    `Виплата зарплати за першу половину ${currentMonth}`,
    'Звільнення', 'Відпустка', 'Лікарняні',
  ];
}
