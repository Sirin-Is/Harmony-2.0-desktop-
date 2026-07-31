// Pure income-limit rules. Keeping this calculation separate from rendering
// makes the warning deterministic and protects it with small unit tests.

import { toNumber } from './utils.js';

/**
 * Warn when the remaining annual limit is less than three average income
 * months. Empty and zero-income months are deliberately excluded from the
 * average: they are not evidence that the client's usual income is zero.
 */
export function isIncomeLimitWarning(limit, monthlyValues) {
  const values = monthlyValues.map((value) => toNumber(value));
  const positiveMonths = values.filter((value) => value > 0);
  if (!Number.isFinite(limit) || limit <= 0 || !positiveMonths.length) return false;

  const totalIncome = values.reduce((sum, value) => sum + value, 0);
  const averageIncome = totalIncome / positiveMonths.length;
  return limit - totalIncome < averageIncome * 3;
}
