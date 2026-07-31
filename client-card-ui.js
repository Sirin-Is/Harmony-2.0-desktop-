// client-card-ui.js
// Картка клієнта — єдиний редактор ФОП (замінює колишнє вікно
// редагування). Раніше (Етап "лагодження") цей файл викликав глобальні
// функції з app.js напряму (спільний non-module scope). Тепер, коли
// app.js більше не підключений, він працює через state.js — так само,
// як і решта UI-шару.
//
// Після збереження/приховання/видалення файл не імпортує bootstrap.js
// напряму (це створило б циклічний імпорт), а надсилає подію
// 'harmony:changed', на яку bootstrap.js підписаний і перемальовує
// поточний вигляд.

import { escapeHtml, generateId } from './utils';
import { getClientById, upsertClient, archiveClient } from './state.js';
import { openAppDialog } from './app-dialog.js';
import { enhanceDateInputs } from './date-input.js';
import { showToast } from './toast.js';
import { validateKved, openKvedResults } from './kved-validation.js';
import * as XLSX from 'xlsx';

const esc = escapeHtml;
const uid = generateId;

const overlay = document.createElement('div');
overlay.className = 'cc-overlay';
document.body.appendChild(overlay);

const RATE_OPTIONS = {
  '1': [{ value: '0.1', label: '10%' }],
  '2': [{ value: '0.2', label: '20%' }, { value: '0.15', label: '15%' }, { value: '0.1', label: '10%' }],
  '3': [{ value: '0.05', label: '5%' }, { value: '0.03', label: '3% + ПДВ' }],
  'Загальна': [{ value: '', label: 'Не застосовується' }],
};

const FIELD_DEFAULTS = {
  rnokpp: '', source: '',
  contractFileName: '', agreementsText: '',
  pricingBase: '', pricingStaff: '', pricingPrro: '',
  prroName: '',
  kepValidFrom: '', registrationAddress: '',
  kvedMainCode: '', kvedMainName: '', kvedAdditional: [],
  additionalInfo: '', accounts: [], employees: [],
};

let draft = null;
let isNew = false;

function val(id) { return document.getElementById(id)?.value.trim() ?? ''; }

function additionalKved(value) {
  if (Array.isArray(value)) return value.map((item) => ({ id: item?.id || uid(), code: item?.code || '', name: item?.name || '' }));
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return additionalKved(parsed);
  } catch { /* Previous versions stored the field as free text. */ }
  return String(value).split(/\r?\n/).map((line) => {
    const [code = '', ...name] = line.split(/\s+[—–-]\s+/);
    return { id: uid(), code: code.trim(), name: name.join(' — ').trim() };
  }).filter((item) => item.code || item.name);
}

function kvedRowHtml(item, index) {
  return `<div class="cc-kved-pair">
    <input class="cc-kved-code" data-kved-index="${index}" data-kved-id="${esc(item.id || '')}" data-kved-field="code" placeholder="XX.XX" value="${esc(item.code || '')}" aria-label="Код КВЕД">
    <div class="cc-kved-name-wrap"><textarea class="cc-kved-name" data-kved-index="${index}" data-kved-id="${esc(item.id || '')}" data-kved-field="name" rows="1" placeholder="Назва виду діяльності" aria-label="Назва КВЕД">${esc(item.name || '')}</textarea></div>
    <button type="button" class="icon cc-kved-remove" data-remove-kved="${index}" title="Видалити КВЕД">✕</button>
  </div>`;
}

function getSpreadsheetRows(file) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) : [];
  });
}

function column(row, names) {
  const found = Object.keys(row).find((key) => names.some((name) => key.trim().toLocaleLowerCase('uk-UA') === name));
  return found === undefined ? '' : String(row[found] ?? '').trim();
}

function inputDate(value) {
  const text = String(value || '');
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const local = text.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  return local ? `${local[3]}-${local[2]}-${local[1]}` : '';
}

function currencyCode(value) {
  const code = String(value || '').match(/\b(980|978|840)\b/)?.[1];
  return ({ 980: 'UAH', 978: 'EUR', 840: 'USD' })[code] || String(value || '').trim();
}

function notifyChanged() {
  document.dispatchEvent(new CustomEvent('harmony:changed'));
}

function accountRowHtml(a, i) {
  a = a || {};
  return `<tr>
    <td><input class="cc-acc" data-i="${i}" data-k="bankName" value="${esc(a.bankName || '')}"></td>
    <td class="cc-acc-code"><input class="cc-acc" data-i="${i}" data-k="code" value="${esc(a.code || '')}"></td>
    <td class="cc-acc-currency"><input class="cc-acc" data-i="${i}" data-k="currency" value="${esc(a.currency || '')}"></td>
    <td class="cc-acc-iban"><input class="cc-acc" data-i="${i}" data-k="iban" value="${esc(a.iban || '')}"></td>
    <td><input class="cc-acc" data-i="${i}" data-k="openDate" type="date" value="${esc(a.openDate || '')}"></td>
    <td><button type="button" class="icon" data-remove-acc="${i}" title="Видалити рахунок">✕</button></td>
  </tr>`;
}

function bodyHtml() {
  const d = draft;
  const total = [d.pricingBase, d.pricingStaff, d.pricingPrro].reduce((s, v) => s + (Number(v) || 0), 0);
  const rateOpts = RATE_OPTIONS[d.group] || [];
  const additional = additionalKved(d.kvedAdditional);
  return `
    <div class="cc-top">
      <div class="cc-avatar" title="Фото (заглушка)">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>
      </div>
      <div>
        <div class="cc-name">${esc(d.name || 'Новий клієнт')}</div>
        <div class="cc-sub">${esc(d.group || '-')} група${d.rate ? ' / ' + (Number(d.rate) * 100) + '%' : ''}</div>
      </div>
    </div>

    <div class="cc-grid">
      <fieldset><legend>Основна інформація</legend>
        <label>ПІБ / назва ФОП<input id="cc_name" value="${esc(d.name)}" required></label>
        <label>Група ЄП<select id="cc_group"><option value="" ${d.group ? '' : 'selected'}>Оберіть групу</option>${['1', '2', '3', 'Загальна'].map((g) => `<option ${d.group === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label>Ставка ЄП<select id="cc_rate"><option value="" ${d.rate ? '' : 'selected'}>${d.group ? 'Оберіть ставку' : 'Спочатку оберіть групу'}</option>${rateOpts.map((o) => `<option value="${o.value}" ${String(o.value) === String(d.rate) ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>
        <label>РНОКПП / ЄДРПОУ<input id="cc_rnokpp" value="${esc(d.rnokpp)}"></label>
        <label>Телефон<input id="cc_phone" value="${esc(d.phone)}"></label>
        <label>Ел. пошта<input id="cc_email" type="email" value="${esc(d.email)}"></label>
        <label>Джерело залучення<input id="cc_source" value="${esc(d.source)}"></label>
      </fieldset>

      <fieldset><legend>Документи та вартість</legend>
        <label>Договір — файл<input id="cc_contractFileName" value="${esc(d.contractFileName)}"></label>
        <label>Додаткові угоди<textarea id="cc_agreementsText">${esc(d.agreementsText)}</textarea></label>
        <label>База, грн<input id="cc_pricingBase" type="number" min="0" value="${esc(d.pricingBase)}"></label>
        <label>Дод. за найманих, грн<input id="cc_pricingStaff" type="number" min="0" value="${esc(d.pricingStaff)}"></label>
        <label>Дод. за ПРРО, грн<input id="cc_pricingPrro" type="number" min="0" value="${esc(d.pricingPrro)}"></label>
        <label>Разом, грн<input id="cc_serviceTotal" value="${total}" readonly></label>
      </fieldset>

      <fieldset><legend>Обслуговування та КЕП</legend>
        <label>Клієнт-банк(и)<textarea id="cc_banks">${esc(d.banks)}</textarea></label>
        <div class="cc-employees-block"><label>Наймані працівники</label><div class="cc-employees" id="cc_employees">${(d.employees || []).map(employeeRowHtml).join('')}</div><div class="cc-inline-actions"><button type="button" class="secondary" id="cc_addEmployee">+ Працівник</button></div></div>
        <label>ПРРО / РРО<input id="cc_prroName" value="${esc(d.prroName)}"></label>
        <label>Видавець КЕП<input id="cc_kepIssuer" value="${esc(d.kepIssuer)}"></label>
        <label>КЕП дійсний з<input id="cc_kepValidFrom" type="date" value="${esc(d.kepValidFrom)}"></label>
        <label>КЕП дійсний до<input id="cc_kepExpiry" type="date" value="${esc(d.kepExpiry)}"></label>
        <label>Адреса реєстрації<textarea id="cc_registrationAddress">${esc(d.registrationAddress)}</textarea></label>
        <label>ДПІ<input id="cc_taxOffice" value="${esc(d.taxOffice)}"></label>
      </fieldset>

      <fieldset><legend>Обрані коди КВЕД</legend>
        <label>Основний КВЕД</label>
        <div class="cc-kved-pair is-primary">
          <input class="cc-kved-code" id="cc_kvedMainCode" placeholder="XX.XX" value="${esc(d.kvedMainCode)}" aria-label="Основний код КВЕД">
          <textarea class="cc-kved-name" id="cc_kvedMainName" rows="1" placeholder="Назва основного виду діяльності" aria-label="Назва основного КВЕД">${esc(d.kvedMainName)}</textarea>
        </div>
        <div class="cc-kved-list" id="cc_kvedAdditional">${additional.map(kvedRowHtml).join('')}</div>
        <div class="cc-inline-actions"><button type="button" class="secondary cc-kved-add-btn" id="cc_addKved">+ КВЕД</button><button type="button" class="secondary cc-kved-import-btn" id="cc_importKved">Імпорт КВЕД</button><button type="button" class="secondary" id="cc_checkKved">Перевірити КВЕД</button></div>
        <input id="cc_kvedFile" type="file" accept=".xlsx,.xls" hidden>
      </fieldset>
    </div>

    <fieldset class="cc-wide"><legend>Рахунки для підприємницької діяльності</legend>
      <table class="table cc-acc-table"><thead><tr>
        <th>Банк / Установа</th><th>Код</th><th>Валюта</th><th>IBAN</th><th>Дата відкриття</th><th></th>
      </tr></thead><tbody id="cc_accounts">${(d.accounts || []).map(accountRowHtml).join('')}</tbody></table>
      <div class="cc-inline-actions cc-acc-actions"><button type="button" class="secondary" id="cc_addAccount">+ Рахунок</button><button type="button" class="secondary cc-acc-import-btn" id="cc_importAccounts">Імпорт</button></div>
      <input id="cc_accountsFile" type="file" accept=".xlsx,.xls" hidden>
    </fieldset>

    <fieldset class="cc-wide"><legend>Додаткова інформація</legend>
      <label>Опис<textarea id="cc_additionalInfo">${esc(d.additionalInfo)}</textarea></label>
    </fieldset>
  `;
}

function readForm() {
  ['name', 'phone', 'email', 'source', 'contractFileName',
    'agreementsText', 'pricingBase', 'pricingStaff', 'pricingPrro', 'banks',
    'prroName', 'kepIssuer', 'kepValidFrom', 'kepExpiry', 'registrationAddress', 'taxOffice',
    'kvedMainCode', 'kvedMainName', 'additionalInfo', 'rnokpp']
    .forEach((k) => { draft[k] = val(`cc_${k}`); });
  draft.kvedAdditional = Array.from(overlay.querySelectorAll('[data-kved-index]')).reduce((items, input) => {
    const index = Number(input.dataset.kvedIndex);
    items[index] = items[index] || { id: input.dataset.kvedId || uid(), code: '', name: '' };
    items[index][input.dataset.kvedField] = input.value.trim();
    return items;
  }, []).filter((item) => item.code || item.name);
  draft.employees = Array.from(overlay.querySelectorAll('[data-employee-index]')).reduce((items, input) => {
    const index = Number(input.dataset.employeeIndex);
    // Keep the employee's persistent ID while the card is edited. Without it,
    // merely saving a card looks like deleting and recreating every employee.
    items[index] = items[index] || { id: input.dataset.employeeId || uid(), name: '', position: '' };
    items[index][input.dataset.employeeField] = input.value.trim();
    return items;
  }, []).filter((item) => item.name || item.position);
  draft.employeesCount = String(draft.employees.length);
  draft.hadEmployees = Boolean(draft.hadEmployees || draft.employees.length);
  draft.group = document.getElementById('cc_group')?.value ?? draft.group;
  draft.rate = document.getElementById('cc_rate')?.value ?? draft.rate;
  draft.serviceCost = [draft.pricingBase, draft.pricingStaff, draft.pricingPrro].reduce((s, v) => s + (Number(v) || 0), 0);
}

function employeeRowHtml(employee, index) {
  return `<div class="cc-employee-row"><input data-employee-index="${index}" data-employee-id="${esc(employee.id || '')}" data-employee-field="name" placeholder="ПІБ працівника" value="${esc(employee.name || '')}"><input data-employee-index="${index}" data-employee-id="${esc(employee.id || '')}" data-employee-field="position" placeholder="Посада" value="${esc(employee.position || '')}"><button type="button" class="icon" data-remove-employee="${index}" title="Видалити працівника">✕</button></div>`;
}

function bindKved() {
  document.getElementById('cc_checkKved')?.addEventListener('click', () => {
    readForm();
    openKvedResults(`Перевірка КВЕД: ${draft.name || 'новий ФОП'}`, validateKved(draft));
  });
  document.getElementById('cc_addKved')?.addEventListener('click', () => {
    readForm();
    draft.kvedAdditional.push({ id: uid(), code: '', name: '' });
    paint();
  });
  overlay.querySelectorAll('[data-remove-kved]').forEach((button) => button.addEventListener('click', () => {
    readForm();
    draft.kvedAdditional.splice(Number(button.dataset.removeKved), 1);
    paint();
  }));
  document.getElementById('cc_importKved')?.addEventListener('click', () => document.getElementById('cc_kvedFile')?.click());
  document.getElementById('cc_kvedFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = await getSpreadsheetRows(file);
      const imported = rows.map((row) => ({
        code: column(row, ['код вед', 'код квед']),
        name: column(row, ['найменування вед', 'найменування квед', 'назва вед']),
        main: ['1', 'так', 'true', 'yes'].includes(column(row, ['основна']).toLowerCase()),
      })).filter((item) => item.code || item.name);
      if (!imported.length) throw new Error('У файлі не знайдено рядків КВЕД.');
      readForm();
      const primary = imported.find((item) => item.main);
      if (primary) {
        draft.kvedMainCode = primary.code;
        draft.kvedMainName = primary.name;
      }
      draft.kvedAdditional = [...additionalKved(draft.kvedAdditional), ...imported.filter((item) => !item.main).map(({ code, name }) => ({ id: uid(), code, name }))];
      paint();
      showToast(`Імпортовано ${imported.length} кодів КВЕД.`, 'success');
    } catch (error) {
      showToast(error.message || 'Не вдалося прочитати файл КВЕД.', 'error');
    } finally { event.target.value = ''; }
  });
}

function bindAutoGrowingKvedNames() {
  overlay.querySelectorAll('.cc-kved-name').forEach((field) => {
    const resize = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    };
    field.addEventListener('input', resize);
    resize();
  });
}

function bindPricingTotal() {
  const fields = ['cc_pricingBase', 'cc_pricingStaff', 'cc_pricingPrro'].map((id) => document.getElementById(id));
  const total = document.getElementById('cc_serviceTotal');
  const update = () => {
    if (!total) return;
    total.value = fields.reduce((sum, field) => sum + (Number(field?.value) || 0), 0);
  };
  fields.forEach((field) => field?.addEventListener('input', update));
  update();
}

function bindAccounts() {
  document.getElementById('cc_addAccount')?.addEventListener('click', () => {
    draft.accounts = draft.accounts || [];
    draft.accounts.push({ id: uid() });
    readForm();
    paint();
  });
  overlay.querySelectorAll('.cc-acc').forEach((input) => input.addEventListener('change', () => {
    const i = Number(input.dataset.i);
    draft.accounts[i] = draft.accounts[i] || {};
    draft.accounts[i][input.dataset.k] = input.value;
  }));
  overlay.querySelectorAll('[data-remove-acc]').forEach((btn) => btn.addEventListener('click', () => {
    readForm();
    draft.accounts.splice(Number(btn.dataset.removeAcc), 1);
    paint();
  }));
  document.getElementById('cc_importAccounts')?.addEventListener('click', () => document.getElementById('cc_accountsFile')?.click());
  document.getElementById('cc_accountsFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = await getSpreadsheetRows(file);
      const imported = rows.map((row) => ({
        id: uid(),
        code: column(row, ['мфо банку']),
        bankName: column(row, ['назва банку']),
        iban: column(row, ['номер рахунку']),
        bankCode: column(row, ['код банку']),
        currency: currencyCode(column(row, ['валюта рахунку'])),
        openDate: inputDate(column(row, ['дата відкриття рахунку'])),
        registeredDate: inputDate(column(row, ['дата взяття на облік'])),
      })).filter((item) => item.bankName || item.iban || item.code);
      if (!imported.length) throw new Error('У файлі не знайдено рахунків.');
      readForm();
      draft.accounts = [...(draft.accounts || []), ...imported];
      paint();
      showToast(`Імпортовано ${imported.length} рахунків.`, 'success');
    } catch (error) {
      showToast(error.message || 'Не вдалося прочитати файл рахунків.', 'error');
    } finally { event.target.value = ''; }
  });
}

function bindEmployees() {
  document.getElementById('cc_addEmployee')?.addEventListener('click', () => {
    readForm();
    draft.employees.push({ id: uid(), name: '', position: '' });
    paint();
  });
  overlay.querySelectorAll('[data-remove-employee]').forEach((button) => button.addEventListener('click', () => {
    readForm();
    draft.employees.splice(Number(button.dataset.removeEmployee), 1);
    draft.employeesCount = String(draft.employees.length);
    paint();
  }));
}

function paint() {
  const scrollTop = overlay.querySelector('.cc-body')?.scrollTop || 0;
  overlay.innerHTML = `<div class="cc-window">
    <div class="cc-header">
      <div class="cc-title">${isNew ? 'Новий ФОП' : 'Картка клієнта'}</div>
      <button type="button" class="cc-close" data-cc-close title="Закрити">✕</button>
    </div>
    <div class="cc-body">${bodyHtml()}</div>
    <div class="cc-actions">
      ${!isNew ? `<button type="button" class="secondary" data-cc-hide>🗄 Деактивувати</button>` : ''}
      <span style="flex:1"></span>
      <button type="button" class="secondary" data-cc-close>Скасувати</button>
      <button type="button" class="primary" data-cc-save>Зберегти</button>
    </div>
  </div>`;

  bindAccounts();
  bindEmployees();
  bindKved();
  bindAutoGrowingKvedNames();
  bindPricingTotal();
  enhanceDateInputs(overlay);
  overlay.querySelector('.cc-body').scrollTop = scrollTop;
  overlay.querySelectorAll('[data-cc-close]').forEach((b) => b.addEventListener('click', close));
  overlay.querySelector('[data-cc-save]')?.addEventListener('click', save);
  overlay.querySelector('[data-cc-hide]')?.addEventListener('click', async () => {
    const result = await openAppDialog({ title: 'Деактивація ФОП', message: 'Вкажіть причину та введіть повний ПІБ для підтвердження.', fields: [{ key: 'reason', label: 'Причина деактивації', value: draft.inactiveReason || '', required: true }, { key: 'name', label: `Повний ПІБ: ${draft.name}`, required: true }], confirmText: 'Деактивувати', danger: true });
    if (!result) return;
    if (result.name !== draft.name) { alert('ПІБ не збігається. Деактивацію скасовано.'); return; }
    archiveClient(draft.id, true, result.reason);
    close();
    notifyChanged();
  });
  document.getElementById('cc_group')?.addEventListener('change', () => {
    readForm();
    draft.rate = '';
    paint();
  });
}

function save() {
  readForm();
  if (!draft.name || draft.name.trim().length < 2) {
    alert('Вкажіть ПІБ / назву ФОП (мінімум 2 символи).');
    return;
  }
  upsertClient(draft, isNew ? null : draft.id);
  close();
  notifyChanged();
}

function close() {
  overlay.classList.remove('open');
  draft = null;
}

export function openClientCard(id) {
  const existing = id ? getClientById(id) : null;
  isNew = !existing;
  draft = { ...FIELD_DEFAULTS, ...(existing || { id: uid(), form: 'ФОП', customFields: {} }) };
  draft.accounts = (draft.accounts || []).map((a) => ({ ...a }));
  draft.kvedAdditional = additionalKved(draft.kvedAdditional);
  draft.employees = (draft.employees || []).map((employee) => ({ id: employee.id || uid(), ...employee }));
  draft.hadEmployees = Boolean(draft.hadEmployees || draft.employees.length || Number(draft.employeesCount));
  overlay.classList.add('open');
  paint();
}
