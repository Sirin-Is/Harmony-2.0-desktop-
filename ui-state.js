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
  dashboardFilters: {},
  dashboardFilterOpen: null,
  selectedClientIds: new Set(),
  pendingHighlightClientId: null,
  deletedSectionUnlocked: false,
  calendarMonth: null,
  calendarSection: 'calendar',
  calendarTaskDate: null,
  hrSection: 'employees',
  hrDocumentsMonth: null,
  payrollMonth: null,
  activitiesSection: 'kved',
  activitiesSearch: '',
  settingsSection: 'general',
  syncConflicts: [],
  syncLog: [],
  currentUser: null,
  managedUsers: [],
  localStorageProtection: null,
  auditSearch: '',
  auditType: '',
  auditStatus: '',
  auditSection: '',
  auditClient: '',
  auditActor: '',
  auditDate: '',
};
