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
  contractFileName: '', contractLink: '', contractNumber: '', agreementsText: '',
  pricingBase: '', pricingStaff: '', pricingPrro: '',
  staffStatus: '', prroName: '',
  kepValidFrom: '', registrationAddress: '',
  kvedMainCode: '', kvedMainName: '', kvedAdditional: '',
  additionalInfo: '', accounts: [],
};

let draft = null;
let isNew = false;

function val(id) { return document.getElementById(id)?.value.trim() ?? ''; }

function notifyChanged() {
  document.dispatchEvent(new CustomEvent('harmony:changed'));
}

function accountRowHtml(a, i) {
  a = a || {};
  return `<tr>
    <td><input class="cc-acc" data-i="${i}" data-k="bankName" value="${esc(a.bankName || '')}"></td>
    <td><input class="cc-acc" data-i="${i}" data-k="code" value="${esc(a.code || '')}"></td>
    <td><input class="cc-acc" data-i="${i}" data-k="currency" value="${esc(a.currency || '')}"></td>
    <td><input class="cc-acc" data-i="${i}" data-k="iban" value="${esc(a.iban || '')}"></td>
    <td><input class="cc-acc" data-i="${i}" data-k="openDate" type="date" value="${esc(a.openDate || '')}"></td>
    <td><button type="button" class="icon" data-remove-acc="${i}" title="Видалити рахунок">✕</button></td>
  </tr>`;
}

function bodyHtml() {
  const d = draft;
  const total = [d.pricingBase, d.pricingStaff, d.pricingPrro].reduce((s, v) => s + (Number(v) || 0), 0);
  const rateOpts = RATE_OPTIONS[d.group] || RATE_OPTIONS['1'];
  return `
    <div class="cc-top">
      <div class="cc-avatar" title="Фото (заглушка)">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>
      </div>
      <div>
        <div class="cc-name">${esc(d.name || 'Новий клієнт')}</div>
        <div class="cc-sub">${esc(d.group || '—')} група${d.rate ? ' / ' + (Number(d.rate) * 100) + '%' : ''}</div>
      </div>
    </div>

    <div class="cc-grid">
      <fieldset><legend>Основна інформація</legend>
        <label>ПІБ / назва ФОП<input id="cc_name" value="${esc(d.name)}" required></label>
        <label>Група ЄП<select id="cc_group">${['1', '2', '3', 'Загальна'].map((g) => `<option ${d.group === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label>Ставка ЄП<select id="cc_rate">${rateOpts.map((o) => `<option value="${o.value}" ${String(o.value) === String(d.rate) ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>
        <label>РНОКПП / ЄДРПОУ<input id="cc_rnokpp" value="${esc(d.rnokpp)}"></label>
        <label>Телефон<input id="cc_phone" value="${esc(d.phone)}"></label>
        <label>Зв'язок (Telegram)<input id="cc_contactLink" placeholder="https://t.me/username" value="${esc(d.contactLink)}"></label>
        <label>Ел. пошта<input id="cc_email" type="email" value="${esc(d.email)}"></label>
        <label>Джерело залучення<input id="cc_source" value="${esc(d.source)}"></label>
        <label><input id="cc_isTestRecord" type="checkbox" ${d.isTestRecord ? 'checked' : ''}> Тестовий запис</label>
      </fieldset>

      <fieldset><legend>Документи та вартість</legend>
        <label>Договір — файл<input id="cc_contractFileName" value="${esc(d.contractFileName)}"></label>
        <label>Договір — посилання<input id="cc_contractLink" value="${esc(d.contractLink)}"></label>
        <label>Договір — номер<input id="cc_contractNumber" value="${esc(d.contractNumber)}"></label>
        <label>Додаткові угоди<textarea id="cc_agreementsText">${esc(d.agreementsText)}</textarea></label>
        <label>База, грн<input id="cc_pricingBase" type="number" min="0" value="${esc(d.pricingBase)}"></label>
        <label>Дод. за найманих, грн<input id="cc_pricingStaff" type="number" min="0" value="${esc(d.pricingStaff)}"></label>
        <label>Дод. за ПРРО, грн<input id="cc_pricingPrro" type="number" min="0" value="${esc(d.pricingPrro)}"></label>
        <label>Разом, грн<input value="${total}" readonly></label>
      </fieldset>

      <fieldset><legend>Обслуговування та КЕП</legend>
        <label>Клієнт-банк(и)<textarea id="cc_banks">${esc(d.banks)}</textarea></label>
        <label>Наймані — кількість<input id="cc_employeesCount" type="number" min="0" value="${esc(d.employeesCount)}"></label>
        <label>Наймані — статус<input id="cc_staffStatus" value="${esc(d.staffStatus)}"></label>
        <label>ПРРО / РРО<input id="cc_prroName" value="${esc(d.prroName)}"></label>
        <label>Видавець КЕП<input id="cc_kepIssuer" value="${esc(d.kepIssuer)}"></label>
        <label>КЕП дійсний з<input id="cc_kepValidFrom" type="date" value="${esc(d.kepValidFrom)}"></label>
        <label>КЕП дійсний до<input id="cc_kepExpiry" type="date" value="${esc(d.kepExpiry)}"></label>
        <label>Адреса реєстрації<textarea id="cc_registrationAddress">${esc(d.registrationAddress)}</textarea></label>
        <label>ДПІ<input id="cc_taxOffice" value="${esc(d.taxOffice)}"></label>
      </fieldset>

      <fieldset><legend>Обрані коди КВЕД</legend>
        <label>Основний код<input id="cc_kvedMainCode" value="${esc(d.kvedMainCode)}"></label>
        <label>Назва основного коду<input id="cc_kvedMainName" value="${esc(d.kvedMainName)}"></label>
        <label>Додаткові коди (по рядку: код — назва)<textarea id="cc_kvedAdditional">${esc(d.kvedAdditional)}</textarea></label>
      </fieldset>
    </div>

    <fieldset class="cc-wide"><legend>Рахунки для підприємницької діяльності</legend>
      <table class="table cc-acc-table"><thead><tr>
        <th>Банк / Установа</th><th>Код</th><th>Валюта</th><th>IBAN</th><th>Дата відкриття</th><th></th>
      </tr></thead><tbody id="cc_accounts">${(d.accounts || []).map(accountRowHtml).join('')}</tbody></table>
      <button type="button" class="secondary" id="cc_addAccount" style="margin-top:8px">+ Рахунок</button>
    </fieldset>

    <fieldset class="cc-wide"><legend>Додаткова інформація</legend>
      <label>Опис<textarea id="cc_additionalInfo">${esc(d.additionalInfo)}</textarea></label>
    </fieldset>
  `;
}

function readForm() {
  ['name', 'phone', 'contactLink', 'email', 'source', 'contractFileName', 'contractLink', 'contractNumber',
    'agreementsText', 'pricingBase', 'pricingStaff', 'pricingPrro', 'banks', 'employeesCount', 'staffStatus',
    'prroName', 'kepIssuer', 'kepValidFrom', 'kepExpiry', 'registrationAddress', 'taxOffice',
    'kvedMainCode', 'kvedMainName', 'kvedAdditional', 'additionalInfo', 'rnokpp']
    .forEach((k) => { draft[k] = val(`cc_${k}`); });
  draft.group = document.getElementById('cc_group')?.value || draft.group;
  draft.rate = document.getElementById('cc_rate')?.value ?? draft.rate;
  draft.isTestRecord = Boolean(document.getElementById('cc_isTestRecord')?.checked);
  draft.serviceCost = [draft.pricingBase, draft.pricingStaff, draft.pricingPrro].reduce((s, v) => s + (Number(v) || 0), 0);
}

function bindAccounts() {
  document.getElementById('cc_addAccount')?.addEventListener('click', () => {
    draft.accounts = draft.accounts || [];
    draft.accounts.push({});
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
}

function paint() {
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
  overlay.classList.add('open');
  paint();
}
