// ui-state.js
// Transient "where am I looking" state. Deliberately separate from
// state.js: this is UI navigation, not persisted business data.
//
// Етап 2: додано reportGroup/reportPeriod/incomeGroup/paymentsQuarter/
// pendingHighlightClientId — усі вони вже використовувались в app.js,
// але були відсутні тут.

export const uiState = {
  view: 'overview',
  taxGroup: '12',
  taxPeriod: null,
  reportGroup: '12',
  reportPeriod: null,
  incomeGroup: '12',
  paymentsQuarter: null,
  dashboardSearch: '',
  selectedClientIds: new Set(),
  pendingHighlightClientId: null,
  deletedSectionUnlocked: false,
};
