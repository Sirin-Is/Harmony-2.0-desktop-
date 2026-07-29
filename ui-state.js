// ui-state.js
// Transient "where am I looking" state. Deliberately separate from
// state.js: this is UI navigation, not persisted business data, and
// keeping it apart avoids polluting the data layer with view concerns.

export const uiState = {
  view: 'dashboard',
  taxGroup: '1',
  taxPeriod: null,
  dashboardSearch: '',
  selectedClientIds: new Set(),
};
