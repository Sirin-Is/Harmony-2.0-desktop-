import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { assertBackupFileSize, createEncryptedBackup, decryptBackup, MAX_BACKUP_FILE_BYTES, validateBackupDatabase } from '../backup-crypto.js';
import { assertSpreadsheetArchive, assertSpreadsheetFile, assertSpreadsheetRows, loadSpreadsheetLibrary, MAX_SPREADSHEET_ARCHIVE_BYTES, MAX_SPREADSHEET_DATA_ROWS, MAX_SPREADSHEET_FILE_BYTES, readSpreadsheetRows } from '../spreadsheet-security.js';
import { shortDate, shortDateToIso } from '../date-input.js';
import { collectDatabaseRelationshipIssues } from '../data/database-validation.js';
import { validateSyncPayload } from '../data/identifier-validation.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordPolicyError } from '../password-policy.js';
import { escapeHtml } from '../utils.js';
import { normalizeHrOrderNumber, validateHrOrder } from '../hr-order-model.js';
import { normalizeEmployeeName, validateEmployee } from '../employee-model.js';
import { defaultPayrollDates, payrollDateForPaymentType, payrollDatesForPeriod, payrollPaymentTypes } from '../payroll-model.js';
import { isValidIsoDate, isValidMonthPeriodKey, isValidReportPeriodKey, isValidTaxPeriodKey, validateCalendarEvent, validateReportRecordChange, validateTaxRecordChange } from '../workflow-validation.js';
import { activityPermission, findActivityByCode, loadActivityReference, normalizeActivityCode } from '../data/activity-reference.js';
import { birthDateFromRnokpp, findClientByImportName, groupAtPeriod, normalizeClientName } from '../client-model.js';

test('політика паролів компенсує недоступну перевірку витоків на Free Plan', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(MAX_PASSWORD_LENGTH, 128);
  assert.match(passwordPolicyError('password1234', 'worker'), /передбачуваний/i);
  assert.match(passwordPolicyError('Worker-2026!', 'worker'), /логін/i);
  assert.match(passwordPolicyError('alllowercase', 'worker'), /три групи/i);
  assert.equal(passwordPolicyError('Довга парольна фраза 2026', 'worker'), '');
  assert.equal(passwordPolicyError('Safe-Work-2026!', 'worker'), '');
});

test('HTML-атрибути не дозволяють ID з резервної копії перетворити на DOM-XSS', () => {
  const maliciousId = 'record" autofocus onfocus="globalThis.pwned=1';
  const escaped = escapeHtml(maliciousId);
  assert.equal(escaped, 'record&quot; autofocus onfocus=&quot;globalThis.pwned=1');
  assert.doesNotMatch(escaped, /"/);

  const sources = [
    'dashboard.js', 'calendar.js', 'deleted.js', 'inactive.js', 'incomes.js',
    'overview.js', 'payments.js', 'reports.js', 'taxes.js', 'hr.js',
  ].map((name) => readFileSync(new URL(`../render/${name}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /data-[\w-]+="\$\{(?:item|record|event|subtask|column|order|e)\.(?:id|seriesId)/);

  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /querySelectorAll\('tr\[data-row-id\]'\)[\s\S]*row\.dataset\.rowId === targetId/);
  assert.doesNotMatch(bootstrap, /querySelectorAll\(`tr\[data-row-id="\$\{targetId\}"\]`\)/);
});

let vite;
let tax;
let reports;
let clients;
let income;
let writeRetry;
let databaseHealth;
let SyncManager;
let limitPushBatch;
let MAX_PUSH_BATCH_BYTES;
let parseStoredSyncCursor;
let workspaceDatabaseUrl;
let validateClient;
let validateImportRow;
let validateCustomColumn;
let readSyncJsonResponse;
let MAX_SYNC_RESPONSE_BYTES;
let isAlreadyAppliedAddColumn;
let parseStoredObjectPayload;
let assertRecordPayloadIdentity;
let normalizeSessionPayload;
let parseHarmonyProfile;
let moneyValidation;
let mergeCalendarCompletion;
let jsonValuesEqual;
let threeWayMerge;

before(async () => {
  // Vite's SSR loader executes the same TypeScript modules that the desktop
  // app uses, without starting Tauri or touching SQLite.
  vite = await createServer({
    root: process.cwd(),
    configFile: false,
    cacheDir: '.vite-test',
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      middlewareMode: true,
      fs: { allow: [process.cwd()] },
      watch: { ignored: ['**/target/**', '**/.cargo-target-*/**', '**/.chrome-audit*/**', '**/.edge-audit*/**'] },
    },
  });
  globalThis.window = globalThis.window || globalThis;
  globalThis.window.addEventListener ||= () => {};
  globalThis.window.removeEventListener ||= () => {};
  globalThis.window.dispatchEvent ||= () => true;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  tax = await vite.ssrLoadModule('/tax-model.ts');
  reports = await vite.ssrLoadModule('/report-model.ts');
  clients = await vite.ssrLoadModule('/client-model.ts');
  income = await vite.ssrLoadModule('/income-model.js');
  writeRetry = await vite.ssrLoadModule('/write-retry.js');
  databaseHealth = await vite.ssrLoadModule('/data/database-health.ts');
  ({ SyncManager, limitPushBatch, MAX_PUSH_BATCH_BYTES } = await vite.ssrLoadModule('/sync/sync-manager.ts'));
  ({ parseStoredSyncCursor } = await vite.ssrLoadModule('/data/sync-types.ts'));
  ({ workspaceDatabaseUrl } = await vite.ssrLoadModule('/data/workspace-database.ts'));
  ({ validateClient, validateImportRow, validateCustomColumn } = await vite.ssrLoadModule('/validation.js'));
  ({ readSyncJsonResponse, MAX_SYNC_RESPONSE_BYTES } = await vite.ssrLoadModule('/sync/supabase-gateway.ts'));
  ({ isAlreadyAppliedAddColumn } = await vite.ssrLoadModule('/data/migrations.ts'));
  ({ parseStoredObjectPayload } = await vite.ssrLoadModule('/data/stored-payload.ts'));
  ({ assertRecordPayloadIdentity } = await vite.ssrLoadModule('/data/record-identity.ts'));
  ({ normalizeSessionPayload } = await vite.ssrLoadModule('/auth/session.ts'));
  ({ parseHarmonyProfile } = await vite.ssrLoadModule('/auth/users.ts'));
  moneyValidation = await vite.ssrLoadModule('/money-validation.js');
  ({ mergeCalendarCompletion } = await vite.ssrLoadModule('/data/sqlite-repository.ts'));
  ({ jsonValuesEqual, threeWayMerge } = await vite.ssrLoadModule('/data/three-way-merge.ts'));
});

after(async () => {
  await vite?.close();
});

test('податкові дедлайни 1–2 груп переносяться на попередню п’ятницю', () => {
  assert.equal(tax.statutoryTaxDeadline('2', 'unified', '2026-06'), '2026-06-20');
  assert.equal(tax.calculatedTaxDeadline('2', 'unified', '2026-06'), '2026-06-19'); // 20 червня — субота
  assert.equal(tax.calculatedTaxDeadline('1', 'military', '2026-09'), '2026-09-18'); // 20 вересня — неділя
  assert.equal(tax.calculatedTaxDeadline('2', 'esv', '2026-03'), '2026-04-20');
});

test('податкові дедлайни 3 групи рахуються від завершення кварталу', () => {
  assert.equal(tax.calculatedTaxDeadline('3', 'unified', '2026-q1'), '2026-05-20');
  assert.equal(tax.calculatedTaxDeadline('3', 'military', '2026-half'), '2026-08-19');
  assert.equal(tax.calculatedTaxDeadline('3', 'esv', '2026-9m'), '2026-10-20');
});

test('звітність має окремі квартальні та річні дедлайни', () => {
  assert.equal(reports.statutoryReportDeadline('3', '2026-q1'), '2026-05-10');
  assert.equal(reports.getDefaultReportDeadline({}, '3', '2026-q1'), '2026-05-08'); // 10 травня — неділя
  assert.equal(reports.getDefaultReportDeadline({}, '3', '2026-year'), '2027-02-09');
  assert.equal(reports.getDefaultReportDeadline({}, '2', '2026'), '2027-03-01');
  assert.equal(reports.annualPropertyIncomeDeclarationDeadline(2026), '2026-04-30');
  assert.equal(reports.annualPropertyIncomeDeclarationDeadline(2027), '2027-04-30');
});

test('об’єднані звіти ведуться для всіх ФОП поквартально з дедлайном 40 днів', () => {
  assert.deepEqual(reports.combinedReportPeriodsFor(2026).map((period) => period.label), ['I квартал', 'II квартал', 'III квартал', 'IV квартал']);
  assert.equal(reports.statutoryCombinedReportDeadline('2026-q1'), '2026-05-10');
  assert.equal(reports.getDefaultCombinedReportDeadline({}, '2026-q1'), '2026-05-08'); // 10 травня — неділя
  assert.equal(reports.getDefaultCombinedReportDeadline({ settings: { reportDeadlines: { combined: { '2026-half': '2026-08-06' } } } }, '2026-half'), '2026-08-06');
});

test('типи виплати зарплати залежать від вибраного періоду, а не попереднього екрана', () => {
  assert.deepEqual(payrollPaymentTypes('2026-08').slice(0, 2), [
    'Виплата ЗП за другу половину липня',
    'Виплата ЗП за першу половину серпня',
  ]);
  assert.equal(payrollPaymentTypes('2026-01')[0], 'Виплата ЗП за другу половину грудня');
  assert.deepEqual(payrollPaymentTypes('2026-13'), []);
});

test('зарплатний графік використовує 7/22 і переносить вихідні на попередній робочий день', () => {
  assert.deepEqual(defaultPayrollDates('2026-08'), { secondHalf: '2026-08-07', firstHalf: '2026-08-21' });
  assert.deepEqual(defaultPayrollDates('2026-11'), { secondHalf: '2026-11-06', firstHalf: '2026-11-20' });
  const settings = { payrollDates: { '2026-08': { secondHalf: '2026-08-05', firstHalf: '2026-08-19' } } };
  assert.deepEqual(payrollDatesForPeriod(settings, '2026-08'), { secondHalf: '2026-08-07', firstHalf: '2026-08-21' });
  assert.deepEqual(payrollDatesForPeriod({ payrollSchedule: { secondHalfDay: 6, firstHalfDay: 20 } }, '2026-08'), { secondHalf: '2026-08-06', firstHalf: '2026-08-20' });
  assert.equal(payrollDateForPaymentType(settings, '2026-08', 'Виплата ЗП за другу половину липня'), '2026-08-07');
  assert.equal(payrollDateForPaymentType(settings, '2026-08', 'Виплата ЗП за першу половину серпня'), '2026-08-21');
  assert.equal(payrollDateForPaymentType(settings, '2026-08', 'Лікарняні'), '');
});

test('налаштування зарплати не містять помісячних полів, але дозволяють змінити спільні числа графіка', () => {
  const settingsSource = readFileSync(new URL('../render/settings.js', import.meta.url), 'utf8');
  const bootstrapSource = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.doesNotMatch(settingsSource, /data-scope="payroll"/);
  assert.match(settingsSource, /data-payroll-schedule="secondHalfDay"[\s\S]*data-payroll-schedule="firstHalfDay"/);
  assert.match(bootstrapSource, /field\.type !== 'radio' \|\| field\.checked/);
  assert.match(bootstrapSource, /Приклад довідника КВЕД\/NACE успішно завантажено/);
  assert.match(bootstrapSource, /Не вдалося завантажити приклад довідника/);
});

test('картка конфлікту показує користувацький контекст запису', () => {
  const settingsSource = readFileSync(new URL('../render/settings.js', import.meta.url), 'utf8');
  assert.match(settingsSource, /sync-conflict-context/);
  assert.match(settingsSource, /label: 'Розділ'/);
  assert.match(settingsSource, /label: 'ФОП'/);
  assert.match(settingsSource, /label: 'Період'/);
  assert.match(settingsSource, /label: 'Відрізняється полів'/);
});

test('синхронізація автоматично зливає лише стан виконання підзадачі', () => {
  const remote = { id: 'task-1', title: 'Звіт', completedAt: '', completedDates: [], subtasks: [{ id: 'sub-1', title: 'Перевірити', completedAt: '', completedDates: [] }] };
  const local = { ...remote, subtasks: [{ ...remote.subtasks[0], completedAt: '2026-08-10T08:00:00.000Z', completionUpdatedAt: '2026-08-10T08:00:00.000Z' }] };
  const merged = JSON.parse(mergeCalendarCompletion(JSON.stringify(local), JSON.stringify(remote)));
  assert.equal(merged.subtasks[0].completedAt, '2026-08-10T08:00:00.000Z');
  assert.equal(mergeCalendarCompletion(JSON.stringify({ ...local, title: 'Інша задача' }), JSON.stringify(remote)), null);
});

test('тристороннє злиття автоматично поєднує зміни різних полів', () => {
  const base = { name: 'ФОП', email: 'old@example.com', settings: { color: 'white', radius: 5 } };
  const local = { ...base, email: 'local@example.com' };
  const remote = { ...base, settings: { ...base.settings, color: 'blue' } };
  const result = threeWayMerge(base, local, remote);
  assert.deepEqual(result.conflictPaths, []);
  assert.deepEqual(result.merged, { name: 'ФОП', email: 'local@example.com', settings: { color: 'blue', radius: 5 } });
});

test('конфлікт виникає лише для різних змін того самого поля', () => {
  const base = { email: 'old@example.com', note: '' };
  const result = threeWayMerge(base, { email: 'local@example.com', note: 'локальна' }, { email: 'remote@example.com', note: '' });
  assert.deepEqual(result.conflictPaths, ['email']);
  assert.deepEqual(result.localCandidate, { email: 'local@example.com', note: 'локальна' });
  assert.deepEqual(result.remoteCandidate, { email: 'remote@example.com', note: 'локальна' });
  assert.equal(result.merged, null);
});

test('JSON з іншим порядком ключів і однакові паралельні зміни не конфліктують', () => {
  assert.equal(jsonValuesEqual({ first: 1, second: { a: true, b: null } }, { second: { b: null, a: true }, first: 1 }), true);
  const result = threeWayMerge({ status: 'old' }, { status: 'done' }, { status: 'done' });
  assert.deepEqual(result.conflictPaths, []);
  assert.deepEqual(result.merged, { status: 'done' });
});

test('ініціалізація бази використовує актуальний очищувач технічного шуму аудиту', () => {
  const stateSource = readFileSync(new URL('../state.js', import.meta.url), 'utf8');
  assert.doesNotMatch(stateSource, /suppressTechnicalEmployeeAuditNoise/);
  assert.match(stateSource, /initDatabase[\s\S]*normalizeAuditFieldLabels\(db\.auditEvents \|\| \[\]\)[\s\S]*suppressTechnicalNestedAuditNoise\(db\.auditEvents \|\| \[\]\)/);
});

test('лічильник звітності після подання фіксує фактичну різницю до дедлайну', () => {
  assert.match(reports.reportDaysUntilLabel('2026-05-08', { submittedDate: '2026-05-06' }), /2 дн\./);
  assert.match(reports.reportDaysUntilLabel('2026-05-08', { submittedDate: '2026-05-10' }), /-2 дн\./);
});

test('статус звіту відрізняє своєчасне подання від простроченого', () => {
  assert.deepEqual(reports.reportStatus({ submittedDate: '2026-05-08' }, '2026-05-08'), { text: 'Подано вчасно', cls: 'ok' });
  assert.deepEqual(reports.reportStatus({ submittedDate: '2026-05-10' }, '2026-05-08'), { text: 'Подано із запізненням', cls: 'late' });
});

test('ручне введення дат приймає коректний формат дд.мм.рррр і відхиляє неможливі дати', () => {
  assert.equal(shortDate('2026-07-31'), '31.07.2026');
  assert.equal(shortDateToIso('29.02.2024'), '2024-02-29');
  assert.equal(shortDateToIso('31.12.2026'), '2026-12-31');
  assert.equal(shortDateToIso('29.02.2023'), null);
  assert.equal(shortDateToIso('31.04.2026'), null);
  assert.equal(shortDateToIso('1.1.2026'), null);
  assert.equal(shortDate('2026-02-31'), '');
});

test('РНОКПП визначає дату народження з перших п’яти цифр', () => {
  assert.equal(birthDateFromRnokpp('0000100000'), '1900-01-01');
  assert.equal(birthDateFromRnokpp('1234567890'), '1933-10-19');
  assert.equal(birthDateFromRnokpp('12345'), '');
  assert.equal(birthDateFromRnokpp('12345-67890'), '1933-10-19');
});

test('історія групи показує ФОП у групі, що діяла на початок періоду', () => {
  const client = { group: '2', groupChanges: [
    { previousGroup: '2', group: '3', effectiveDate: '2026-04-01' },
    { previousGroup: '3', group: '2', effectiveDate: '2026-07-01' },
  ] };
  assert.equal(groupAtPeriod(client, '2026-03'), '2');
  assert.equal(groupAtPeriod(client, '2026-03-31'), '2');
  assert.equal(groupAtPeriod(client, '2026-04-01'), '3');
  assert.equal(groupAtPeriod(client, '2026-half'), '3');
  assert.equal(groupAtPeriod(client, '2026-9m'), '2');
});

test('статус 3 групи використовує збережену дату сплати, а не поточну групу ФОП', () => {
  const record = { queuedDate: '2026-07-07', paidDate: '2026-08-10' };
  assert.deepEqual(tax.taxStatus(record, '2026-08-19'), { text: 'Вчасно', cls: 'ok' });
  assert.match(tax.daysUntilLabel('2026-08-19', record), /9 дн\./);
});

test('валідація картки ФОП не пропускає критичні помилки, але попереджає про дублікати', () => {
  const invalid = validateClient({ name: 'А', email: 'not-email', serviceCost: '-1', kepExpiry: '2026-99-99' }, [], null);
  assert.equal(invalid.errors.length, 4);
  const invalidPricing = validateClient({ name: 'Коректний ФОП', pricingBase: '-1', pricingStaff: 'не число', pricingPrro: '0' }, [], null);
  assert.equal(invalidPricing.errors.length, 2);
  const duplicate = validateClient({ name: '  Тестовий ФОП ', email: 'test@example.com', serviceCost: '0' }, [{ id: 'existing', name: 'тестовий фоп' }], null);
  assert.match(duplicate.warnings[0], /вже є в списку/);
});

test('користувацькі колонки мають короткі унікальні назви', () => {
  const existing = [{ id: 'column-1', name: 'Внутрішній номер', type: 'text' }];
  assert.match(validateCustomColumn({ name: ' внутрішній НОМЕР ', type: 'number' }, existing).errors[0], /вже існує/);
  assert.match(validateCustomColumn({ name: 'x'.repeat(81), type: 'text' }, []).errors[0], /80 символів/);
  assert.deepEqual(validateCustomColumn({ name: 'Менеджер', type: 'text' }, existing), { errors: [], warnings: [] });
});

test('грошові поля приймають український формат і відхиляють від’ємні та надмірні суми', () => {
  assert.deepEqual(moneyValidation.normalizeNonNegativeAmount('1 234,50'), { ok: true, value: '1234.50' });
  assert.equal(moneyValidation.normalizeNonNegativeAmount('-0.01').ok, false);
  assert.equal(moneyValidation.normalizeNonNegativeAmount('1000000000000').ok, false);
  assert.deepEqual(moneyValidation.normalizeNonNegativeAmount('-', { allowDash: true }), { ok: true, value: '-' });
  assert.equal(moneyValidation.formatEditableAmount('1700').replace(/\s/g, ' '), '1 700,00');
  assert.equal(moneyValidation.formatEditableAmount('1 700'), moneyValidation.formatEditableAmount('1700'));
  assert.equal(moneyValidation.formatEditableAmount('-'), '');
});

test('критичні захисти етапу 1 підключені до UI та журналу аудиту', () => {
  const cardUi = readFileSync(new URL('../client-card-ui.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  const state = readFileSync(new URL('../state.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(cardUi, /validateClient\(draft, getVisibleClients\(\), isNew \? null : draft\.id\)/);
  assert.match(bootstrap, /title: 'Видалити зарплатний рядок'/);
  assert.match(bootstrap, /String\(event\.key \|\| ''\)\.toLowerCase\(\)/);
  assert.match(state, /revertedOperationIds:/);
  assert.match(state, /status: 'cancelled'/);
  assert.match(state, /isSamePayrollSlot/);
  assert.match(styles, /\.table-wrap \{[^}]*overflow-x: auto/);
  assert.doesNotMatch(styles, /\.top-scrollbar \{[^}]*display:\s*none\s*!important/);
  assert.match(index, /class="nav-icon"/);
  assert.match(index, /class="nav-label"/);
  assert.match(styles, /\.nav-icon svg \{[^}]*stroke: currentColor/);
  assert.doesNotMatch(index, /📊|👥|💸|🏛|📈|📋|🪪|📅|💼|⏸️|⚙️|📜/);
});

test('кадровий реєстр не приймає дублікати номера документа для одного ФОП', () => {
  assert.equal(normalizeHrOrderNumber(' №  15-К '), '15-к');
  const existing = [{ id: 'order-1', clientId: 'client-1', number: '№ 15-К' }];
  const fields = { clientId: 'client-1', number: '15-к', date: '2026-08-10', subject: 'Прийняття', effectiveDate: '2026-08-11' };
  assert.match(validateHrOrder(fields, existing).reason, /уже є/);
  assert.equal(validateHrOrder({ ...fields, clientId: 'client-2' }, existing).ok, true);
  assert.match(validateHrOrder({ ...fields, date: '2026-02-30' }, []).reason, /коректні дати/);
});

test('картка працівника вимагає роботодавця, посаду і коректну хронологію дат', () => {
  const valid = { clientId: 'client-1', name: '  Іваненко  Іван ', position: 'Менеджер', hireDate: '2026-02-01', dismissalDate: '' };
  assert.equal(validateEmployee(valid).ok, true);
  assert.equal(normalizeEmployeeName(valid.name), 'іваненко іван');
  assert.match(validateEmployee({ ...valid, position: '' }).reason, /посаду/);
  assert.match(validateEmployee({ ...valid, dismissalDate: '2026-01-31' }).reason, /не може передувати/);
  assert.match(validateEmployee({ ...valid, hireDate: '2026-02-30' }).reason, /коректні дати/);
  assert.equal(validateEmployee({ ...valid, hireDate: '' }).ok, true);
  const card = readFileSync(new URL('../employee-card-ui.js', import.meta.url), 'utf8');
  const hr = readFileSync(new URL('../render/hr.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.match(card, /Пов’язані документи/);
  assert.match(card, /data-employee-order-status/);
  assert.match(card, /data-employee-doc-prev/);
  assert.match(card, /data-employee-doc-next/);
  assert.doesNotMatch(card, /\.innerHTML\s*=/);
  assert.match(card, /replaceChildren\(heading, navigation, documentRows/);
  assert.match(card, /filter\(\(order\) => String\(order\.date \|\| ''\)\.startsWith\(`\$\{year\}-`\)\)/);
  assert.match(hr, /data-add-employee/);
  assert.match(hr, /data-open-employee/);
  assert.match(bootstrap, /openEmployeeCard\(button\.dataset\.openEmployee\)/);
});

test('імпорт доходів однаково знаходить ПІБ із Excel і Harmony', () => {
  assert.equal(normalizeClientName('  Іванов\u00a0Іван\u200b Іванович  '), normalizeClientName('Іванов Іван Іванович'));
  const db = { clients: [{ id: 'one', name: 'Іванов Іван Іванович' }, { id: 'two', name: 'Петренко Петро Петрович' }] };
  assert.equal(findClientByImportName(db, 'Іванов Іван')?.id, 'one');
  assert.equal(findClientByImportName(db, 'Петренко Петро Петрович')?.id, 'two');
  const incomes = readFileSync(new URL('../render/incomes.js', import.meta.url), 'utf8');
  assert.match(incomes, /import \{ escapeHtml, moneyFormat, MONTH_NAMES_UA, monthPeriodKey \} from '\.\.\/utils'/);
});

test('етап 2 підключає пошук, очищення фільтрів і доступні стани навігації', () => {
  const dashboard = readFileSync(new URL('../render/dashboard.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(dashboard, /data-dashboard-search/);
  assert.match(dashboard, /data-clear-dashboard-filters/);
  assert.match(bootstrap, /aria-current/);
  assert.match(bootstrap, /aria-pressed/);
  assert.match(bootstrap, /\['Enter', ' '\]/);
  assert.match(bootstrap, /uiState\.dashboardSearch = ''/);
  assert.match(index, /class="skip-link"/);
});

test('доменна валідація відхиляє неможливі дати та суперечливу податкову хронологію', () => {
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.match(validateTaxRecordChange({ queuedDate: '2026-08-10' }, 'paidDate', '2026-08-09').reason, /не може передувати/);
  assert.equal(validateTaxRecordChange({ queuedDate: '2026-08-10' }, 'paidDate', '2026-08-10').ok, true);
  assert.equal(validateReportRecordChange('submittedDate', '2026-13-01').ok, false);
  assert.equal(validateReportRecordChange('unknown', '').ok, false);
});

test('повторювана задача не завершується раніше старту й має обмежений інтервал', () => {
  const task = { title: 'Подати звіт', note: 'Перевірити квитанцію', eventDate: '2026-08-10', eventTime: '09:30' };
  assert.equal(validateCalendarEvent(task).ok, true);
  assert.match(validateCalendarEvent({ ...task, recurrence: { frequency: 'monthly', interval: 1, until: '2026-08-09' } }).reason, /раніше/);
  assert.match(validateCalendarEvent({ ...task, recurrence: { frequency: 'monthly', interval: 121, until: '' } }).reason, /від 1 до 120/);
  assert.equal(validateCalendarEvent({ ...task, eventTime: '25:10' }).ok, false);
});

test('етап 3 підключає доменну валідацію до стану та показує помилки у формах', () => {
  const state = readFileSync(new URL('../state.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.match(state, /validateTaxRecordChange/);
  assert.match(state, /validateReportRecordChange/);
  assert.match(state, /validateCalendarEvent/);
  assert.match(state, /normalized <= 0/);
  assert.match(bootstrap, /сплата не може передувати/);
  assert.match(bootstrap, /діапазон повторення/);
});

test('фінальний accessibility-прохід додає контекст полям таблиць і станам збереження', () => {
  const sources = ['dashboard.js', 'payments.js', 'taxes.js', 'reports.js', 'hr.js']
    .map((name) => readFileSync(new URL(`../render/${name}`, import.meta.url), 'utf8')).join('\n');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const toast = readFileSync(new URL('../toast.js', import.meta.url), 'utf8');
  assert.match(sources, /aria-label="Набрано в банку:/);
  assert.match(sources, /data-report-status/);
  assert.match(sources, /aria-label="Статус виплати:/);
  assert.match(sources, /aria-pressed=/);
  assert.match(index, /id="syncStatus"[^>]*aria-live="polite"/);
  assert.match(toast, /\['error', 'warn'\]\.includes\(type\) \? 'alert' : 'status'/);
  assert.match(toast, /'Escape'/);
});

test('робочі періоди суворо відповідають типу бізнес-запису', () => {
  assert.equal(isValidMonthPeriodKey('2026-08'), true);
  assert.equal(isValidMonthPeriodKey('2026-13'), false);
  assert.equal(isValidTaxPeriodKey('2', '2026-08'), true);
  assert.equal(isValidTaxPeriodKey('3', '2026-q1'), true);
  assert.equal(isValidTaxPeriodKey('3', '2026-08'), false);
  assert.equal(isValidReportPeriodKey('2', '2026'), true);
  assert.equal(isValidReportPeriodKey('2', '2026-q1'), false);
});

test('mutation boundary перевіряє клієнта, поле, період і дозволені статуси', () => {
  const state = readFileSync(new URL('../state.js', import.meta.url), 'utf8');
  assert.match(state, /!\['charged', 'paid'\]\.includes\(type\)/);
  assert.match(state, /!\['paymentDate', 'amount', 'pdfo', 'vz', 'esv', 'status'\]\.includes\(field\)/);
  assert.match(state, /!\['timesheetStatus', 'payrollStatus', 'cashStatementStatus'\]\.includes\(field\)/);
  assert.match(state, /clientModel\.groupAtPeriod\(client, period\) !== String\(realGroup\)/);
  assert.match(state, /db\.customColumns\.some\(\(column\) => column\.id === columnId\)/);
});

test('часті табличні зміни зберігають лише змінені рядки без повного snapshot diff', () => {
  const state = readFileSync(new URL('../state.js', import.meta.url), 'utf8');
  const storage = readFileSync(new URL('../storage.js', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../data/sqlite-repository.ts', import.meta.url), 'utf8');
  const syncManager = readFileSync(new URL('../sync/sync-manager.ts', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.match(state, /function saveTargetedChanges[\s\S]*inverseChanges[\s\S]*storage\.scheduleMutations/);
  assert.match(state, /setTaxField[\s\S]*saveTargetedChanges\(\[change\], 'Змінено податковий запис'/);
  assert.match(state, /setReportField[\s\S]*saveTargetedChanges\(\[change\], 'Змінено декларацію'/);
  assert.match(state, /setCombinedReportField[\s\S]*saveTargetedChanges\(\[change\], 'Змінено об’єднаний звіт'/);
  assert.match(state, /setIncomeValue[\s\S]*saveTargetedChanges\(\[change\], 'Змінено дохід'/);
  assert.match(state, /setMonthlyPaymentField[\s\S]*saveTargetedChanges\(\[change\], 'Змінено оплату послуг'/);
  assert.match(state, /setPayrollField[\s\S]*saveTargetedChanges\(changes, 'Змінено запис виплати зарплати'/);
  assert.match(state, /upsertClient\(fields, existingId\)[\s\S]*saveTargetedEntity\('clients'/);
  assert.match(state, /saveCalendarEvent[\s\S]*saveTargetedEntity\('calendarEvents'/);
  assert.match(storage, /const pendingMutations = new Map\(\)[\s\S]*Last write wins[\s\S]*repository\.applyMutations\(mutations\)/);
  assert.match(repository, /async applyMutations\(mutations: LocalMutation\[\]\)[\s\S]*grouped = new Map[\s\S]*UPDATE \$\{table\}[\s\S]*VALUES \$\{values\}[\s\S]*ON CONFLICT\(id\) DO UPDATE/);
  assert.match(syncManager, /let received = 0[\s\S]*if \(received\) window\.dispatchEvent/);
  assert.match(bootstrap, /editing \|\| hasPendingLocalChanges\(\)[\s\S]*scheduleRemoteUiRefresh\(800\)/);
});

test('поле Telegram відкриває лише HTTPS-посилання точного домену t.me', () => {
  assert.equal(clients.safeContactHref('t.me/example'), 'https://t.me/example');
  assert.equal(clients.safeContactHref('https://t.me/example'), 'https://t.me/example');
  assert.equal(clients.safeContactHref('http://t.me/example'), null);
  assert.equal(clients.safeContactHref('https://t.me.evil.example/example'), null);
  assert.equal(clients.safeContactHref('https://t.me@evil.example/example'), null);
  assert.match(clients.contactLinkHtml({ contactLink: 'javascript:alert(1)' }), /^javascript:/);
  assert.doesNotMatch(clients.contactLinkHtml({ contactLink: 'javascript:alert(1)' }), /<a\b/);
});

test('імпорт не додає рядок із критично некоректними грошима або поштою', () => {
  const invalid = validateImportRow({ name: 'Тестовий ФОП', email: 'wrong-email', serviceCost: '-50' }, 12);
  assert.equal(invalid.errors.length, 2);
  assert.equal(invalid.warnings.length, 0);
  assert.deepEqual(validateImportRow({ name: 'Тестовий ФОП', email: 'ok@example.com', serviceCost: '1 000,50', group: '3', rate: '0.05', kepExpiry: '2026-12-31' }, 13), { errors: [], warnings: [] });
  assert.equal(validateImportRow({ name: 'Тестовий ФОП', serviceCost: 'abc' }, 14).errors.length, 1);
  assert.equal(validateImportRow({ name: 'Тестовий ФОП', group: '1', rate: '0.05' }, 15).errors.length, 1);
  assert.equal(validateImportRow({ name: 'Тестовий ФОП', kepExpiry: '2026-02-31' }, 16).errors.length, 1);
});

test('ставки та ліміти груп ФОП обмежені дозволеними значеннями', () => {
  assert.deepEqual(clients.rateOptionsForGroup('1').map((item) => item.value), ['0.1']);
  assert.deepEqual(clients.rateOptionsForGroup('2').map((item) => item.value), ['0.2', '0.15', '0.1']);
  assert.deepEqual(clients.rateOptionsForGroup('3').map((item) => item.value), ['0.05', '0.03']);
  assert.equal(clients.groupLimitAmount('3', 8647), 10091049);
  assert.equal(clients.kepDaysLabel('not-a-date'), '-');
});

test('попередження ліміту ігнорує порожні місяці, але враховує середній дохід', () => {
  const limit = 1444049;
  assert.equal(income.isIncomeLimitWarning(limit, ['500 000', '500000', '', 0]), true);
  assert.equal(income.isIncomeLimitWarning(limit, ['100 000', '', '0', '-']), false);
  assert.equal(income.isIncomeLimitWarning(limit, ['', 0, '-']), false);
});

test('суми з пробілами й комою обробляються як числа', () => {
  assert.equal(income.isIncomeLimitWarning(1000, ['800,50']), true);
  assert.equal(income.isIncomeLimitWarning(6000, ['1 000,50', '1 000.50']), false);
});

test('лише тимчасове блокування SQLite запускає обмежений повтор запису', () => {
  assert.equal(writeRetry.isTransientLocalWriteError(new Error('database is locked')), true);
  assert.equal(writeRetry.isTransientLocalWriteError(new Error('SQLITE_BUSY: database file is locked')), true);
  assert.equal(writeRetry.isTransientLocalWriteError(new Error('disk I/O error')), false);
  assert.equal(writeRetry.localSaveRetryDelay(1), 500);
  assert.equal(writeRetry.localSaveRetryDelay(2), 1000);
  assert.equal(writeRetry.localSaveRetryDelay(3), 2000);
  assert.equal(writeRetry.MAX_TRANSIENT_SAVE_RETRIES, 3);
});

test('результат SQLite quick_check безпечно пояснюється в діагностиці', () => {
  assert.deepEqual(databaseHealth.interpretSqliteCheck([{ quick_check: 'ok' }]), { ok: true, detail: 'Цілісність локальної бази підтверджено.' });
  assert.deepEqual(databaseHealth.interpretSqliteCheck([{ quick_check: '*** in database main ***' }, { quick_check: 'Page 4 is never used' }]), { ok: false, detail: '*** in database main *** · Page 4 is never used' });
  assert.equal(databaseHealth.interpretSqliteCheck([]).ok, false);
});

test('старі податкові записи 2026 не губляться після переходу на ключі з роком', () => {
  const database = { taxRecords: { 'fop|3|q1|unified': { deadline: '2026-05-20', note: 'старий запис' } } };
  const record = tax.getTaxRecord(database, 'fop', '3', '2026-q1', 'unified');
  assert.deepEqual(record, { deadline: '2026-05-20', note: 'старий запис' });
  assert.notEqual(record, database.taxRecords['fop|3|q1|unified']);
});

test('видалення ФОП очищує прив’язані записи, але не інші дані', () => {
  const database = {
    clients: [{ id: 'one', name: 'Перший' }, { id: 'two', name: 'Другий' }],
    monthlyPayments: { one: { '2026-01': {} }, two: { '2026-01': {} } },
    incomeRecords: { one: { '2026-01': '100' }, two: { '2026-01': '200' } },
    taxRecords: { 'one|2|2026-01|unified': {}, 'two|2|2026-01|unified': {} },
    reportRecords: { 'one|2|2026': {}, 'two|2|2026': {} },
  };
  assert.equal(clients.deleteClient(database, 'one'), true);
  assert.deepEqual(database.clients.map((item) => item.id), ['two']);
  assert.deepEqual(Object.keys(database.monthlyPayments), ['two']);
  assert.deepEqual(Object.keys(database.incomeRecords), ['two']);
  assert.deepEqual(Object.keys(database.taxRecords), ['two|2|2026-01|unified']);
  assert.deepEqual(Object.keys(database.reportRecords), ['two|2|2026']);
});

test('видалення з неактивних відбувається одразу, а старі відкладені записи мігрують', () => {
  const database = {
    clients: [
      { id: 'due', name: 'Можна перенести', lifecycleStatus: 'inactive', deletionEligibleAt: '2000-01-01' },
      { id: 'wait', name: 'Ще очікує', lifecycleStatus: 'inactive', deletionEligibleAt: '2999-01-01' },
    ],
  };
  assert.equal(clients.advanceScheduledDeletions(database), true);
  assert.equal(database.clients[0].lifecycleStatus, 'deleted');
  assert.equal(database.clients[1].lifecycleStatus, 'inactive');
  assert.equal(clients.requestDeletion(database, 'wait', ''), null);
  const deleted = clients.requestDeletion(database, 'wait', 'Тестова причина');
  assert.equal(deleted?.lifecycleStatus, 'deleted');
  assert.ok(deleted?.deletedAt);
});

test('довідник КВЕД завантажується, нормалізує код і знаходить назву', async () => {
  await loadActivityReference();
  assert.equal(normalizeActivityCode('1,1'), '01.10');
  assert.equal(normalizeActivityCode('01.11'), '01.11');
  assert.equal(normalizeActivityCode('_47.91'), '47.91');
  assert.ok(findActivityByCode('kved', '1.11')?.[1]);
});

test('довідник КВЕД розпізнає обмеження лише для відповідної групи', () => {
  assert.equal(activityPermission('дозволено з обмеженнями'), 'partial');
  assert.equal(activityPermission('дозволено'), 'allowed');
  assert.equal(activityPermission('не дозволено'), 'blocked');
});

test('резервна копія шифрується, відновлюється правильним паролем і відхиляє неправильний', async () => {
  const database = { clients: [{ id: 'fop-1', name: 'Тестовий ФОП' }], settings: {}, calendarEvents: [] };
  const file = await createEncryptedBackup(database, 'надійний-пароль-2026');
  assert.equal(file.encrypted, true);
  assert.equal(file.database, undefined);
  const restored = await decryptBackup(file, 'надійний-пароль-2026');
  assert.deepEqual(restored.database, database);
  await assert.rejects(() => decryptBackup(file, 'неправильний-пароль'));
});

test('нову резервну копію не можна захистити передбачуваним паролем', async () => {
  const database = { clients: [{ id: 'fop-1', name: 'Тестовий ФОП' }], settings: {} };
  await assert.rejects(() => createEncryptedBackup(database, 'aaaaaaaaaaaa'), /Ненадійний пароль/);
  await assert.rejects(() => createEncryptedBackup(database, 'password1234'), /Ненадійний пароль/);
  await assert.doesNotReject(() => createEncryptedBackup(database, 'Довга резервна фраза 2026'));
});

test('відновлення резервної копії обмежує пароль і внутрішню версію контейнера', async () => {
  await assert.rejects(() => decryptBackup({}, 'x'.repeat(129)), /Невірний пароль/);
  const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(main, /MAX_SESSION_BYTES: usize = 128 \* 1024/);
  assert.match(main, /let bytes = unsafe \{ slice::from_raw_parts[\s\S]*?\}\.to_vec\(\);[\s\S]*?CredFree/);
});

test('перевірка резервної копії відхиляє дублікати та пошкоджені колекції', () => {
  assert.throws(() => validateBackupDatabase({ clients: [{ id: 'same' }, { id: 'same' }], settings: {} }));
  assert.throws(() => validateBackupDatabase({ clients: [], settings: [], calendarEvents: [] }));
  assert.doesNotThrow(() => validateBackupDatabase({ clients: [{ id: 'valid' }], settings: {}, auditEvents: [] }));
  assert.throws(() => validateBackupDatabase({ clients: [{ id: 'valid' }], settings: {}, calendarEvents: [{ id: 'event', clientId: 'missing' }] }), /Некоректний зв’язок/);
});

test('резервна копія приймає production-формати ID та відхиляє інʼєкції в ключах', () => {
  const clientId = '73e9c0b5-3f33-4ea6-a28b-7018ce54d874';
  assert.doesNotThrow(() => validateBackupDatabase({
    clients: [{ id: clientId, employees: [{ id: 'id-employee:1' }] }],
    monthlyPayments: { [clientId]: { '2026-01': {} } },
    taxRecords: { [`${clientId}|3|2026-q1|unified`]: {} },
    settings: {},
  }));
  assert.throws(() => validateBackupDatabase({
    clients: [{ id: 'record" autofocus onfocus="alert(1)' }], settings: {},
  }), /Некоректний ідентифікатор/);
  assert.throws(() => validateBackupDatabase({
    clients: [{ id: 'valid', customFields: { 'field onclick=alert(1)': 'x' } }], settings: {},
  }), /Некоректний ідентифікатор/);
  assert.throws(() => validateBackupDatabase({
    clients: [{ id: 'valid' }], monthlyPayments: { 'valid"><img': {} }, settings: {},
  }), /Некоректний ідентифікатор/);
});

test('відкат аудиту не може повторно внести небезпечний ID', () => {
  assert.throws(() => validateBackupDatabase({
    clients: [{ id: 'valid' }],
    auditOperations: [{
      id: 'audit-1',
      beforeSnapshot: { clients: [{ id: 'bad id with spaces' }], settings: {} },
    }],
    settings: {},
  }), /Некоректний ідентифікатор/);
});

test('синхронізація відхиляє prototype pollution і надмірну вкладеність payload', () => {
  assert.throws(() => validateSyncPayload(JSON.parse('{"__proto__":{"polluted":true}}')), /небезпечне імʼя поля/);
  let deeplyNested = {};
  for (let index = 0; index < 21; index += 1) deeplyNested = { child: deeplyNested };
  assert.throws(() => validateSyncPayload(deeplyNested), /глибоку структуру/);
  assert.throws(() => validateSyncPayload({ id: 'bad id' }), /Некоректний ідентифікатор/);
  assert.doesNotThrow(() => validateSyncPayload({ id: 'id-safe:1', note: '<b>звичайний текст</b>' }));
});

test('sync gateway обмежує загальний розмір відповіді до JSON.parse', async () => {
  const valid = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await readSyncJsonResponse(valid), { ok: true });
  const oversized = new Response('{}', { headers: { 'content-length': String(MAX_SYNC_RESPONSE_BYTES + 1) } });
  await assert.rejects(() => readSyncJsonResponse(oversized), /безпечний розмір/);
});

test('sync gateway відхиляє невалідний UTF-8, а push ділиться за загальним бюджетом', async () => {
  await assert.rejects(() => readSyncJsonResponse(new Response(new Uint8Array([0x7b, 0xff, 0x7d]))), /encoded|encoding|UTF/i);
  const record = (id) => ({ entityType: 'clients', id, payload: 'x'.repeat(Math.ceil(MAX_PUSH_BATCH_BYTES / 2)), createdAt: '', updatedAt: '', syncedAt: null, isDeleted: false, syncStatus: 'pending', revision: 0, changeSequence: 0 });
  const selected = limitPushBatch([record('one'), record('two'), record('three')]);
  assert.equal(selected.length, 1);
});

test('CAS-клієнт не вимагає workspace_id, якого немає у відповіді RPC', () => {
  const gateway = readFileSync(new URL('../sync/supabase-gateway.ts', import.meta.url), 'utf8');
  assert.match(gateway, /const remote = fromRemote\(row\)/);
  assert.match(gateway, /remote\.updatedAt = expected\.updatedAt/);
  assert.match(gateway, /rows\.map\(\(row\) => fromRemote\(row, profile\.workspaceId\)\)/);
});

test('відновлення резервної копії обмежує розмір і небезпечну структуру до JSON.parse та запису', () => {
  assert.doesNotThrow(() => assertBackupFileSize({ size: MAX_BACKUP_FILE_BYTES }));
  assert.throws(() => assertBackupFileSize({ size: MAX_BACKUP_FILE_BYTES + 1 }), /25 МБ/);
  assert.throws(() => validateBackupDatabase({ clients: [{ id: 'valid', note: 'x'.repeat(250001) }], settings: {} }), /довге текстове поле/);
  const unsafe = JSON.parse('{"clients":[{"id":"valid","__proto__":{}}],"settings":{}}');
  assert.throws(() => validateBackupDatabase(unsafe), /небезпечне ім’я поля/);
});

test('імпорт таблиць обмежує файл, кількість рядків і розмір комірок', () => {
  assert.doesNotThrow(() => assertSpreadsheetFile({ size: MAX_SPREADSHEET_FILE_BYTES }));
  assert.throws(() => assertSpreadsheetFile({ size: MAX_SPREADSHEET_FILE_BYTES + 1 }), /5 МБ/);
  assert.throws(() => assertSpreadsheetRows(Array.from({ length: MAX_SPREADSHEET_DATA_ROWS + 1 }, () => ({}))), /10000 рядків/);
  assert.throws(() => assertSpreadsheetRows([{ value: 'x'.repeat(10001) }]), /10000 символів/);
  const archive = new ArrayBuffer(68);
  const view = new DataView(archive);
  view.setUint32(0, 0x02014b50, true);
  view.setUint32(24, MAX_SPREADSHEET_ARCHIVE_BYTES + 1, true);
  view.setUint32(46, 0x06054b50, true);
  view.setUint16(56, 1, true);
  view.setUint32(58, 46, true);
  view.setUint32(62, 0, true);
  assert.throws(() => assertSpreadsheetArchive(archive), /50 МБ/);
});

test('підтримуваний SheetJS створює та читає xlsx через захищений lazy-reader', async () => {
  const XLSX = await loadSpreadsheetLibrary();
  assert.equal(XLSX.version, '0.20.3');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['ПІБ', 'Сума'], ['Тестовий ФОП', 1250]]), 'ФОП');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const rows = await readSpreadsheetRows({ size: bytes.byteLength, arrayBuffer: async () => bytes });
  assert.deepEqual(rows, [{ 'ПІБ': 'Тестовий ФОП', 'Сума': '1250' }]);
});

test('перевірка зв’язків не втрачає історичні виплати звільнених працівників', () => {
  const issues = collectDatabaseRelationshipIssues({
    clients: [{ id: 'fop-1' }],
    monthlyPayments: { 'fop-1': {} },
    incomeRecords: { missing: {} },
    payrollRecords: [{ id: 'payroll-1', clientId: 'fop-1', employeeId: 'former-worker' }],
    calendarEvents: [{ id: 'event-1', clientId: 'missing' }],
  });
  assert.deepEqual(issues, ['Доходи: не знайдено ФОП missing.', 'Календар: не знайдено ФОП missing.']);
});

function syncRecord(id = 'record-1') {
  return { entityType: 'clients', id, payload: '{}', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', syncedAt: null, isDeleted: false, syncStatus: 'updated', revision: 0, changeSequence: 0 };
}

function syncFixture(events) {
  let pending = [syncRecord()];
  const repository = {
    getPendingSyncRecords: async () => pending,
    acknowledgePush: async () => { pending = []; events.push('marked'); },
    applyRemoteRecords: async () => [],
    getSyncCursor: async () => null,
    setSyncCursor: async () => {},
    clearSyncCursor: async () => { events.push('clear-cursor'); },
    clearRestoreSyncRequired: async () => { events.push('clear-restore-marker'); },
    logSync: async () => {},
  };
  const remote = {
    healthcheck: async () => { events.push('health'); },
    compareAndSwap: async (records) => { events.push('push'); return records.map((record) => ({ status: 'applied', record: { ...record, revision: record.revision + 1 } })); },
    pullAfter: async () => { events.push('pull'); return []; },
  };
  return { repository, remote };
}

function waitForIdle(manager) {
  return new Promise((resolve) => {
    const stop = manager.onState((state) => {
      if (state === 'idle') { stop(); resolve(); }
    });
  });
}

function waitForIdleCount(manager, expectedCount) {
  return new Promise((resolve) => {
    let count = 0;
    const stop = manager.onState((state) => {
      if (state !== 'idle') return;
      count += 1;
      if (count === expectedCount) { stop(); resolve(); }
    });
  });
}

test('звичайна синхронізація спершу передає локальні зміни, потім отримує хмарні', async () => {
  const events = [];
  const { repository, remote } = syncFixture(events);
  const manager = new SyncManager(repository, remote, async () => ({ role: 'accountant' }));
  const done = waitForIdle(manager);
  manager.requestSync('test');
  await done;
  manager.stop();
  assert.deepEqual(events, ['health', 'push', 'marked', 'pull']);
});

test('CAS підтверджує лише прийняті записи та передає відхилену ревізію в механізм конфліктів', async () => {
  const localAccepted = { ...syncRecord('accepted'), payload: '{"name":"accepted"}', revision: 3 };
  const localRejected = { ...syncRecord('rejected'), payload: '{"name":"local"}', revision: 4 };
  const remoteRejected = { ...localRejected, payload: '{"name":"remote"}', revision: 5, syncStatus: 'synced' };
  let acknowledged = [];
  let compared = [];
  let appliedRemote = [];
  const repository = {
    getPendingSyncRecords: async () => [localAccepted, localRejected],
    acknowledgePush: async (records) => { acknowledged = records; },
    applyRemoteRecords: async (records) => { appliedRemote = records; return [{ id: 'conflict' }]; },
    getSyncCursor: async () => null,
    setSyncCursor: async () => {},
    clearSyncCursor: async () => {},
    logSync: async () => {},
  };
  const remote = {
    healthcheck: async () => {},
    compareAndSwap: async (records) => {
      compared = records;
      return [
        { status: 'applied', record: { ...localAccepted, revision: 4, syncStatus: 'synced' } },
        { status: 'conflict', record: remoteRejected },
      ];
    },
    pullAfter: async () => [],
  };
  const manager = new SyncManager(repository, remote, async () => ({ role: 'accountant' }));
  const done = waitForIdle(manager);
  manager.requestSync('cas-test');
  await done;
  manager.stop();
  assert.deepEqual(compared, [localAccepted, localRejected]);
  assert.deepEqual(acknowledged.map((record) => [record.id, record.revision]), [['accepted', 4]]);
  assert.deepEqual(appliedRemote, [remoteRejected]);
});

test('Supabase revision migration підтримує legacy-upsert і захищає нові CAS-записи', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260807072946_add_sync_record_revisions.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column revision bigint not null default 1/i);
  assert.match(sql, /and target\.revision = v_base_revision/i);
  assert.match(sql, /if v_base_revision = 0 then[\s\S]*on conflict on constraint harmony_records_pkey do nothing[\s\S]*else[\s\S]*update public\.harmony_records/i);
  assert.match(sql, /create trigger harmony_records_assign_revision[\s\S]*before insert or update/i);
  assert.match(sql, /new\.revision := old\.revision \+ 1/i);
  assert.match(sql, /revoke all privileges on table public\.harmony_records from public, anon/i);
  assert.match(sql, /grant select, insert, update, delete on public\.harmony_records to authenticated/i);
  assert.doesNotMatch(sql, /revoke insert, update, delete on public\.harmony_records from authenticated/i);
  assert.match(sql, /check \(pg_column_size\(payload\) <= 1048576\)/i);
  assert.match(sql, /A CAS batch cannot exceed 10 MiB/i);
  assert.match(sql, /create function private\.harmony_compare_and_swap_records/i);
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /create function public\.harmony_compare_and_swap_records[\s\S]*security invoker/i);
  assert.match(sql, /grant execute on function public\.harmony_compare_and_swap_records\(jsonb\) to authenticated/i);
});

test('Supabase migration закриває legacy-таблиці від Data API', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260806200341_lock_down_legacy_tables.sql', import.meta.url), 'utf8');
  const legacyTables = [
    'app_state',
    'calendar_events',
    'tasks',
    'clients',
    'monthly_payments',
    'income_records',
    'tax_records',
  ];

  for (const table of legacyTables) {
    assert.match(sql, new RegExp(`'${table}'`, 'i'));
  }

  assert.match(sql, /to_regclass\(format\('public\.%I', legacy_table\)\)/i);
  assert.match(sql, /revoke all privileges on table public\.%I from public, anon, authenticated/i);
  assert.match(sql, /drop policy if exists "Allow public read" on public\.app_state/i);
  assert.match(sql, /alter default privileges for role postgres in schema public[\s\S]*revoke all privileges on tables from public, anon, authenticated/i);
});

test('Supabase migration забороняє anon викликати службові helper-функції', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260806200310_restrict_harmony_helper_execution.sql', import.meta.url), 'utf8');

  for (const helper of ['harmony_current_role', 'harmony_current_workspace_id', 'harmony_can_write']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${helper}\\(\\) from public, anon`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${helper}\\(\\) to authenticated`, 'i'));
  }
});

test('Supabase profile helpers не використовують SECURITY DEFINER і мають least privilege', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260807074131_tighten_harmony_profile_helpers.sql', import.meta.url), 'utf8');
  for (const helper of ['harmony_current_role', 'harmony_current_workspace_id', 'harmony_can_write']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${helper}\\(\\)[\\s\\S]*?security invoker`, 'i'));
  }
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /revoke all privileges on table public\.harmony_users from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.harmony_users to authenticated/i);
});

test('оновлення ролей серіалізоване й не дозволяє конкурентно втратити останнього адміністратора', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20260807093000_atomic_admin_profile_updates.sql', import.meta.url), 'utf8');
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /for update;/);
  assert.match(migration, /HARMONY_LAST_ADMIN/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});

test('старий timestamp cursor скидається, а server-sequence cursor відновлюється', () => {
  assert.equal(parseStoredSyncCursor(JSON.stringify({ updatedAt: '2026-01-01T00:00:00.000Z', entityType: 'clients', id: 'one' })), null);
  assert.equal(parseStoredSyncCursor('2026-01-01T00:00:00.000Z'), null);
  assert.deepEqual(parseStoredSyncCursor(JSON.stringify({ sequence: 42 })), { sequence: 42 });
  assert.equal(parseStoredSyncCursor(JSON.stringify({ sequence: -1 })), null);
});

test('кожен workspace отримує окремий path-safe SQLite файл', () => {
  assert.equal(workspaceDatabaseUrl(null), 'sqlite:harmony-local.db');
  assert.equal(
    workspaceDatabaseUrl('A0B1C2D3-E4F5-4678-9ABC-DEF012345678'),
    'sqlite:harmony-workspace-a0b1c2d3-e4f5-4678-9abc-def012345678.db',
  );
  assert.throws(() => workspaceDatabaseUrl('../other.db'), /Некоректний ідентифікатор/);
  assert.throws(() => workspaceDatabaseUrl(''), /Некоректний ідентифікатор/);
});

test('legacy SQLite migration має resumable markers і не покладається на pooled BEGIN', () => {
  const source = readFileSync(new URL('../data/sqlite-repository.ts', import.meta.url), 'utf8');
  assert.match(source, /legacy_migration_in_progress/);
  assert.match(source, /legacy_migration_complete/);
  assert.match(source, /ON CONFLICT\(id\) DO UPDATE SET payload = excluded\.payload/i);
  assert.doesNotMatch(source, /execute\('BEGIN/);
});

test('локальні ADD COLUMN migrations відновлюються після crash між DDL і marker', () => {
  const statement = 'ALTER TABLE clients ADD COLUMN revision INTEGER NOT NULL DEFAULT 0';
  assert.equal(isAlreadyAppliedAddColumn(statement, new Error('duplicate column name: revision')), true);
  assert.equal(isAlreadyAppliedAddColumn(statement, new Error('database or disk is full')), false);
  assert.equal(isAlreadyAppliedAddColumn('CREATE TABLE clients (id TEXT)', new Error('duplicate column name: id')), false);
});

test('пошкоджений активний SQLite payload не відкидається як видалений запис', () => {
  assert.deepEqual(parseStoredObjectPayload('{"id":"safe"}', 'clients'), { id: 'safe' });
  assert.throws(() => parseStoredObjectPayload('{broken', 'clients'), /пошкоджений запис/);
  assert.throws(() => parseStoredObjectPayload('null', 'clients'), /пошкоджений запис/);
  assert.throws(() => parseStoredObjectPayload('[]', 'clients'), /пошкоджений запис/);
});

test('row ID завжди відповідає ідентичності всередині payload', () => {
  assert.doesNotThrow(() => assertRecordPayloadIdentity('clients', 'client-1', { id: 'client-1' }));
  assert.doesNotThrow(() => assertRecordPayloadIdentity('monthly_payments', 'client-1|2026-08', { clientId: 'client-1', monthKey: '2026-08' }));
  assert.doesNotThrow(() => assertRecordPayloadIdentity('settings', 'default', {}));
  assert.throws(() => assertRecordPayloadIdentity('clients', 'client-1', { id: 'client-2' }), /не відповідає/);
  assert.throws(() => assertRecordPayloadIdentity('settings', 'settings', {}), /не відповідає/);
});

test('pull просуває cursor лише за server change sequence', async () => {
  const cursors = [];
  let pulls = 0;
  const remoteRecord = { ...syncRecord('remote'), revision: 8, changeSequence: 73, syncStatus: 'synced' };
  const repository = {
    getPendingSyncRecords: async () => [],
    acknowledgePush: async () => {},
    applyRemoteRecords: async () => [],
    getSyncCursor: async () => null,
    setSyncCursor: async (cursor) => { cursors.push(cursor); },
    clearSyncCursor: async () => {},
    logSync: async () => {},
  };
  const remote = {
    healthcheck: async () => {},
    compareAndSwap: async () => [],
    pullAfter: async (cursor) => {
      pulls += 1;
      if (pulls === 1) {
        assert.equal(cursor, null);
        return [remoteRecord];
      }
      assert.deepEqual(cursor, { sequence: 73 });
      return [];
    },
  };
  const manager = new SyncManager(repository, remote, async () => ({ role: 'observer' }));
  const done = waitForIdle(manager);
  manager.requestSync('sequence-test');
  await done;
  manager.stop();
  assert.deepEqual(cursors, [{ sequence: 73 }]);
});

test('Supabase migration призначає commit-ordered sequence через workspace counter', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260807072955_add_server_change_sequence.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table private\.harmony_workspace_sync_counters/i);
  assert.match(sql, /on conflict \(workspace_id\) do update\s+set last_value = counter\.last_value \+ 1/i);
  assert.match(sql, /before insert or update on public\.harmony_records/i);
  assert.match(sql, /unique index harmony_records_workspace_change_seq_uidx/i);
  assert.match(sql, /change_seq := v_row\.change_seq/i);
  assert.match(sql, /drop function public\.harmony_compare_and_swap_records\(jsonb\)[\s\S]*drop function private\.harmony_compare_and_swap_records\(jsonb\)/i);
  assert.match(sql, /create function public\.harmony_compare_and_swap_records[\s\S]*security invoker/i);
});

test('відновлення копії спершу отримує хмарні дані й лише тоді передає локальні', async () => {
  const events = [];
  const { repository, remote } = syncFixture(events);
  const manager = new SyncManager(repository, remote, async () => ({ role: 'administrator' }));
  const done = waitForIdle(manager);
  manager.requestRestoreSync();
  await done;
  manager.stop();
  assert.deepEqual(events, ['health', 'clear-cursor', 'pull', 'clear-restore-marker', 'push', 'marked']);
});

test('локальний snapshot має durable journal і не синхронізує restore до cloud pull', () => {
  const migrations = readFileSync(new URL('../data/migrations.ts', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../data/sqlite-repository.ts', import.meta.url), 'utf8');
  const storage = readFileSync(new URL('../storage.js', import.meta.url), 'utf8');
  assert.match(migrations, /version: 13[\s\S]*CREATE TABLE IF NOT EXISTS save_journal/);
  assert.match(repository, /INSERT INTO save_journal[\s\S]*applySnapshot[\s\S]*DELETE FROM save_journal/);
  assert.match(repository, /recoverInterruptedSave\(connection\)[\s\S]*this\.connection = connection/);
  assert.match(repository, /restore_sync_required/);
  assert.match(storage, /isRestoreSyncRequired[\s\S]*requestRestoreSync\(\)[\s\S]*syncManager\.start\(\)/);
});

test('локальна база зберігає базову серверну версію для тристороннього злиття', () => {
  const migrations = readFileSync(new URL('../data/migrations.ts', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../data/sqlite-repository.ts', import.meta.url), 'utf8');
  assert.match(migrations, /version: 14[\s\S]*ADD COLUMN base_payload TEXT/);
  assert.match(repository, /reconcileEquivalentConflicts/);
  assert.match(repository, /base_payload = \?, revision = \?, change_sequence = \?/);
  assert.match(repository, /mergeJsonPayloads\(local\[0\]\.base_payload, local\[0\]\.payload, record\.payload\)/);
});

test('спостерігач не передає локальні зміни в хмару', async () => {
  const events = [];
  const { repository, remote } = syncFixture(events);
  const manager = new SyncManager(repository, remote, async () => ({ role: 'observer' }));
  const done = waitForIdle(manager);
  manager.requestSync('test');
  await done;
  manager.stop();
  assert.deepEqual(events, ['health', 'pull']);
});

test('відновлення копії очікує завершення активної синхронізації', async () => {
  const events = [];
  const { repository, remote } = syncFixture(events);
  let releaseHealthcheck;
  remote.healthcheck = () => new Promise((resolve) => { releaseHealthcheck = resolve; events.push('health'); });
  const manager = new SyncManager(repository, remote, async () => ({ role: 'administrator' }));
  const syncing = new Promise((resolve) => {
    const stop = manager.onState((state) => { if (state === 'syncing') { stop(); resolve(); } });
  });
  manager.requestSync('test');
  await syncing;
  let paused = false;
  const pause = manager.pauseForRestore().then(() => { paused = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(paused, false);
  releaseHealthcheck();
  await pause;
  assert.equal(paused, true);
  manager.stop();
});

test('зміна під час синхронізації одразу запускає наступний безпечний цикл', async () => {
  const events = [];
  const { repository, remote } = syncFixture(events);
  let releasePush;
  let pushStarted;
  const pushStartedPromise = new Promise((resolve) => { pushStarted = resolve; });
  remote.compareAndSwap = (records) => new Promise((resolve) => { releasePush = () => { events.push('push'); resolve(records.map((record) => ({ status: 'applied', record: { ...record, revision: record.revision + 1 } }))); }; pushStarted(); });
  const manager = new SyncManager(repository, remote, async () => ({ role: 'accountant' }));
  const firstSyncing = new Promise((resolve) => {
    const stop = manager.onState((state) => { if (state === 'syncing') { stop(); resolve(); } });
  });
  const twoCycles = waitForIdleCount(manager, 2);
  manager.requestSync('first-save');
  await firstSyncing;
  manager.requestSync('save-during-sync');
  await pushStartedPromise;
  releasePush();
  await twoCycles;
  manager.stop();
  assert.deepEqual(events, ['health', 'push', 'marked', 'pull', 'health', 'pull']);
});

test('зупинений менеджер не планує синхронізацію після завершення поточного циклу', async () => {
  const events = [];
  const { repository, remote } = syncFixture(events);
  let releaseHealthcheck;
  remote.healthcheck = () => new Promise((resolve) => { releaseHealthcheck = resolve; events.push('health'); });
  const manager = new SyncManager(repository, remote, async () => ({ role: 'accountant' }));
  const syncing = new Promise((resolve) => {
    const stop = manager.onState((state) => { if (state === 'syncing') { stop(); resolve(); } });
  });
  manager.requestSync('test');
  await syncing;
  manager.stop();
  releaseHealthcheck();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ['health', 'push', 'marked', 'pull']);
});

test('неавторизований старт монтує лише заблокований auth gate', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.match(html, /<body class="auth-locked">/i);
  assert.match(html, /<div id="bootOverlay" class="boot-overlay" hidden>/i);
  assert.match(html, /<section id="authGate" class="auth-gate"/i);
  assert.match(html, /<div id="appShell" class="app-shell" hidden inert aria-hidden="true">/i);
  assert.match(bootstrap, /if \(!email\) return;/);
  assert.doesNotMatch(bootstrap, /initDatabase\(uiState\.currentUser\?\.workspaceId \|\| null\)/);
});

test('logout очищує DOM, in-memory snapshot і закриває SQLite', () => {
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  const state = readFileSync(new URL('../state.js', import.meta.url), 'utf8');
  const storage = readFileSync(new URL('../storage.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /setAuthenticatedUi\(false\);[\s\S]*?await signOut\(\);[\s\S]*?await lockDatabase\(\);/);
  assert.match(bootstrap, /closeAppDialog\(\);[\s\S]*?closeClientCard\(\);[\s\S]*?clearToasts\(\);[\s\S]*?\$\('#content'\)\.replaceChildren\(\)/);
  assert.match(state, /export async function lockDatabase\(\)[\s\S]*?db = null;[\s\S]*?lastSnapshot = null;[\s\S]*?undoStack\.length = 0;/);
  assert.match(storage, /export async function closeDatabase\(\)[\s\S]*?syncManager\.stop\(\);[\s\S]*?repository\.close\(\)/);
  const session = readFileSync(new URL('../auth/session.ts', import.meta.url), 'utf8');
  assert.match(session, /await invoke\('clear_auth_session'\);[\s\S]*?\/auth\/v1\/logout\?scope=local/);
  assert.match(session, /LOGOUT_TIMEOUT_MS = 5_000/);
});

test('прострочена offline-сесія не надає доступ до workspace', () => {
  const session = readFileSync(new URL('../auth/session.ts', import.meta.url), 'utf8');
  const users = readFileSync(new URL('../auth/users.ts', import.meta.url), 'utf8');
  assert.match(session, /if \(Number\(session\.expires_at\) > now \+ 60\) return session;/);
  assert.match(session, /if \(!navigator\.onLine\) return null;/);
  assert.doesNotMatch(users, /catch \(error\) \{\s*const cached = await cachedHarmonyUser\(\);\s*if \(cached\) return cached;\s*throw error;\s*\}\s*const id/);
});

test('сесія та профіль проходять сувору перевірку перед наданням локального доступу', () => {
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const session = normalizeSessionPayload({
    access_token: 'header.payload.signature',
    refresh_token: 'refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email: 'user@example.com', injected: 'discarded' },
    injected: 'discarded',
  });
  assert.deepEqual(Object.keys(session).sort(), ['access_token', 'expires_at', 'refresh_token', 'user']);
  assert.equal(session.user.injected, undefined);
  assert.equal(normalizeSessionPayload({ ...session, access_token: 'token with whitespace' }), null);
  assert.equal(normalizeSessionPayload({ ...session, user: { id: 'not-a-uuid' } }), null);

  const profile = parseHarmonyProfile({
    user_id: userId,
    workspace_id: workspaceId,
    login: 'accountant',
    display_name: 'Бухгалтер',
    role: 'accountant',
    is_active: true,
  }, userId);
  assert.equal(profile.workspaceId, workspaceId);
  assert.equal(parseHarmonyProfile({ ...profile, user_id: userId, workspace_id: workspaceId, role: 'owner' }, userId), null);
  assert.equal(parseHarmonyProfile({ user_id: userId, workspace_id: workspaceId, login: 'user', display_name: 'User', role: 'observer', is_active: false }, userId), null);
});

test('Edge Function локально відповідає production JWT hardening', () => {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../supabase/functions/manage-harmony-users/index.ts', import.meta.url), 'utf8');
  const deno = JSON.parse(readFileSync(new URL('../supabase/functions/manage-harmony-users/deno.json', import.meta.url), 'utf8'));

  assert.match(config, /\[functions\.manage-harmony-users\][\s\S]*verify_jwt = true/i);
  assert.match(source, /supabase-js@2\.111\.0/);
  assert.match(source, /MIN_PASSWORD_LENGTH = 8/);
  assert.match(source, /MAX_BODY_BYTES = 32 \* 1024/);
  assert.match(source, /request\.body\.getReader\(\)/);
  assert.match(source, /total > MAX_BODY_BYTES/);
  assert.doesNotMatch(source, /await request\.text\(\)/);
  assert.match(source, /'Cache-Control': 'no-store'/);
  assert.match(source, /displayName\.length > 80/);
  assert.match(source, /rpc\('harmony_admin_update_user'/);
  assert.match(source, /getUserById\(userId\)/);
  assert.equal(deno.imports['@supabase/functions-js'], 'jsr:@supabase/functions-js@2.4.6');
});

test('updater перезапускає застосунок через вузьку Rust command без process plugin', () => {
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.match(main, /#\[tauri::command\]\s+fn restart_app\(app: tauri::AppHandle\) \{ app\.restart\(\); \}/);
  assert.match(main, /generate_handler!\[[^\]]*restart_app/);
  assert.match(bootstrap, /await invoke\('restart_app'\)/);
  assert.equal(packageJson.dependencies['@tauri-apps/plugin-process'], undefined);
  assert.ok(!capability.permissions.some((permission) => permission.startsWith('process:')));
});

test('desktop CSP блокує обхід connect-src через форми, base та вбудований контент', () => {
  const tauriConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const csp = tauriConfig.app.security.csp;
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});

test('EFS захищає наявні SQLite artifacts до відкриття БД і показує діагностичне попередження', () => {
  const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

  for (const suffix of ['.db', '.db-wal', '.db-shm', '.db-journal']) {
    assert.match(main, new RegExp(`ends_with\\(\"\\${suffix}\"\\)`));
  }
  assert.match(main, /fn protect\([\s\S]*encrypt\(&path\)[\s\S]*fs::read_dir\(&path\)[\s\S]*encrypt\(&file_path\)/);
  assert.match(main, /local_data_protection::initialize\(app\.handle\(\)\)/);
  assert.match(main, /STATUS\.get\(\)\.cloned\(\)/);
  assert.match(bootstrap, /Локальна база не захищена EFS/);
  assert.match(bootstrap, /«Налаштування → Діагностика»/);
  assert.doesNotMatch(bootstrap, /локальна база Harmony не захищена Windows EFS[\s\S]*'error', 0/);
});

test('build tooling використовує exact stable Supabase CLI', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.devDependencies.supabase, '2.111.0');
  assert.equal(lock.packages[''].devDependencies.supabase, '2.111.0');
  assert.equal(lock.packages['node_modules/supabase'].version, '2.111.0');
  assert.doesNotMatch(JSON.stringify(lock), /2\.111\.1-beta\.2/);
});

test('виправлені Vite і SheetJS зафіксовані точними відтворюваними джерелами', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.devDependencies.vite, '8.2.1');
  assert.equal(lock.packages['node_modules/vite'].version, '8.2.1');
  assert.equal(packageJson.dependencies.xlsx, 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
  assert.equal(lock.packages['node_modules/xlsx'].version, '0.20.3');
  assert.match(lock.packages['node_modules/xlsx'].integrity, /^sha512-/);
});

test('внутрішня лабораторія дизайну не потрапляє в production-навігацію та router', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /design-test|Тест дизайну/);
  assert.doesNotMatch(bootstrap, /design-test|renderDesignTest/);
});

test('release manifests мають однакову версію CAS-сумісного клієнта', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
  const cargoLock = readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');

  const [major, minor] = packageJson.version.split('.').map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 6), 'CAS-сумісний клієнт має бути версії 1.6.0 або новішої');
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(tauri.version, packageJson.version);
  assert.match(cargo, new RegExp(`^version = "${packageJson.version.replaceAll('.', '\\.')}"$`, 'm'));
  assert.match(cargoLock, new RegExp(`name = "harmony"\\s+version = "${packageJson.version.replaceAll('.', '\\.')}"`));
});

test('CI не виконує рухомі GitHub Actions і перевіряє release tag', () => {
  const workflows = ['release.yml', 'quality.yml', 'codeql.yml'].map((name) =>
    readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8'));
  const source = workflows.join('\n');

  assert.doesNotMatch(source, /uses:\s*[^\s#]+@v\d+/i);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(source, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(source, /github\/codeql-action\/init@c4dd10e44af883a891fe31ced449bcb4a6728b9b/);
  assert.match(source, /tauri-apps\/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f/);
  assert.match(workflows[0], /GITHUB_REF_NAME[\s\S]*does not match manifest version/);
  assert.doesNotMatch(workflows[0], /workflow_dispatch/);
  assert.match(source, /persist-credentials: false/);
  assert.match(workflows[0], /npm ci --ignore-scripts/);
  assert.match(workflows[1], /cargo check --locked/);
});
