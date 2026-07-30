// Centralized unified-tax configuration. Keep the rates and income limits in
// one place so a future working period can receive its own statutory values.

const RATE_OPTIONS = {
  '1': [{ value: '0.1', label: '10%' }],
  '2': [{ value: '0.2', label: '20%' }, { value: '0.15', label: '15%' }, { value: '0.1', label: '10%' }],
  '3': [{ value: '0.05', label: '5%' }, { value: '0.03', label: '3% + ПДВ' }],
  'Загальна': [{ value: '', label: 'Не застосовується' }],
};

const GROUP_LIMIT_MULTIPLIERS = { '1': 167, '2': 834, '3': 1167 };

function yearConfig(minimumWage) {
  return {
    rateOptions: RATE_OPTIONS,
    groupLimits: Object.fromEntries(Object.entries(GROUP_LIMIT_MULTIPLIERS).map(([group, minWages]) => [group, {
      minWages,
      amount: minWages * minimumWage,
    }])),
  };
}

// 2027 is intentionally based on the latest configured period until its
// statutory minimum wage is confirmed and entered here.
const CONFIG_BY_YEAR = {
  2026: yearConfig(8647),
  2027: yearConfig(8647),
};

export function getYearConfig(year) {
  return CONFIG_BY_YEAR[Number(year)] || CONFIG_BY_YEAR[2026];
}
