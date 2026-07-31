import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { createEncryptedBackup, decryptBackup, validateBackupDatabase } from '../backup-crypto.js';

let vite;
let tax;
let reports;
let clients;
let SyncManager;

before(async () => {
  // Vite's SSR loader executes the same TypeScript modules that the desktop
  // app uses, without starting Tauri or touching SQLite.
  vite = await createServer({ root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
  globalThis.window = globalThis.window || globalThis;
  globalThis.window.addEventListener ||= () => {};
  globalThis.window.removeEventListener ||= () => {};
  globalThis.window.dispatchEvent ||= () => true;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  tax = await vite.ssrLoadModule('/tax-model.ts');
  reports = await vite.ssrLoadModule('/report-model.ts');
  clients = await vite.ssrLoadModule('/client-model.ts');
  ({ SyncManager } = await vite.ssrLoadModule('/sync/sync-manager.ts'));
});

after(async () => {
  await vite?.close();
});

test('податкові дедлайни 1–2 груп переносяться на попередню п’ятницю', () => {
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
  assert.equal(reports.getDefaultReportDeadline({}, '3', '2026-q1'), '2026-05-08'); // 10 травня — неділя
  assert.equal(reports.getDefaultReportDeadline({}, '3', '2026-year'), '2027-02-09');
  assert.equal(reports.getDefaultReportDeadline({}, '2', '2026'), '2027-03-01');
});

test('лічильник звітності після подання фіксує фактичну різницю до дедлайну', () => {
  assert.match(reports.reportDaysUntilLabel('2026-05-08', { submittedDate: '2026-05-06' }), /2 дн\./);
  assert.match(reports.reportDaysUntilLabel('2026-05-08', { submittedDate: '2026-05-10' }), /-2 дн\./);
});

test('ставки та ліміти груп ФОП обмежені дозволеними значеннями', () => {
  assert.deepEqual(clients.rateOptionsForGroup('1').map((item) => item.value), ['0.1']);
  assert.deepEqual(clients.rateOptionsForGroup('2').map((item) => item.value), ['0.2', '0.15', '0.1']);
  assert.deepEqual(clients.rateOptionsForGroup('3').map((item) => item.value), ['0.05', '0.03']);
  assert.equal(clients.groupLimitAmount('3', 8647), 10091049);
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

test('відкладене видалення не стирає ФОП раніше 30-денного строку', () => {
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
  assert.ok(clients.requestDeletion(database, 'wait', 'Тестова причина')?.deletionEligibleAt);
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

test('перевірка резервної копії відхиляє дублікати та пошкоджені колекції', () => {
  assert.throws(() => validateBackupDatabase({ clients: [{ id: 'same' }, { id: 'same' }], settings: {} }));
  assert.throws(() => validateBackupDatabase({ clients: [], settings: [], calendarEvents: [] }));
  assert.doesNotThrow(() => validateBackupDatabase({ clients: [{ id: 'valid' }], settings: {}, auditEvents: [] }));
});

function syncRecord(id = 'record-1') {
  return { entityType: 'clients', id, payload: '{}', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', syncedAt: null, isDeleted: false, syncStatus: 'updated' };
}

function syncFixture(events) {
  let pending = [syncRecord()];
  const repository = {
    getPendingSyncRecords: async () => pending,
    markRecordsSynced: async () => { pending = []; events.push('marked'); },
    applyRemoteRecords: async () => [],
    getSyncCursor: async () => null,
    setSyncCursor: async () => {},
    clearSyncCursor: async () => { events.push('clear-cursor'); },
    logSync: async () => {},
  };
  const remote = {
    healthcheck: async () => { events.push('health'); },
    upsert: async () => { events.push('push'); },
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

test('відновлення копії спершу отримує хмарні дані й лише тоді передає локальні', async () => {
  const events = [];
  const { repository, remote } = syncFixture(events);
  const manager = new SyncManager(repository, remote, async () => ({ role: 'administrator' }));
  const done = waitForIdle(manager);
  manager.requestRestoreSync();
  await done;
  manager.stop();
  assert.deepEqual(events, ['health', 'clear-cursor', 'pull', 'push', 'marked']);
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
