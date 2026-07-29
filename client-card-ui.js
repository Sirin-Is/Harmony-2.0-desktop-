// client-card-ui.js
// Replaces the old "edit client" dialog with a card matching the
// "Картка клієнта" template. Deliberately NOT a module: app.js is a
// classic <script>, and its top-level `function`/`let`/`const`
// declarations (client, setArchived, deleteClient, persist, render, db,
// esc, uid) are visible here by name because both scripts share the same
// page's global scope. No duplicate data layer, no separate client list —
// this only edits the one client passed to openClientCard(id).

(function () {
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
    kvedCodes: [{ code: '', name: '' }],
  };

  let draft = null;
  let isNew = false;

  function val(id) { return document.getElementById(id)?.value.trim() ?? ''; }

  function accountRowHtml(a, i) {
    a = a || {};
    const currencyOptions = ['UAH', 'USD', 'EUR'];
    const currencySelect = `<select class="cc-acc" data-i="${i}" data-k="currency"><option value="" ${!a.currency ? 'selected' : ''}>—</option>${currencyOptions.map((value) => `<option value="${value}" ${a.currency === value ? 'selected' : ''}>${value}</option>`).join('')}</select>`;
    return `<tr>
      <td><input class="cc-acc" data-i="${i}" data-k="bankName" value="${esc(a.bankName || '')}"></td>
      <td><input class="cc-acc cc-acc-code" data-i="${i}" data-k="code" value="${esc(a.code || '')}"></td>
      <td>${currencySelect}</td>
      <td><input class="cc-acc cc-acc-iban" data-i="${i}" data-k="iban" value="${esc(a.iban || '')}"></td>
      <td><input class="cc-acc" data-i="${i}" data-k="openDate" type="date" value="${esc(a.openDate || '')}"></td>
      <td><button type="button" class="icon" data-remove-acc="${i}" title="Видалити рахунок">✕</button></td>
    </tr>`;
  }

  function legacyKvedPairs(source) {
    const pairs = [];
    const main = { code: source.kvedMainCode || '', name: source.kvedMainName || '' };
    if (main.code || main.name) pairs.push(main);
    else pairs.push({ code: '', name: '' });
    const extras = String(source.kvedAdditional || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    extras.forEach((line) => {
      const match = line.match(/^([^—-]+?)\s*[—-]\s*(.+)$/);
      pairs.push(match ? { code: match[1].trim(), name: match[2].trim() } : { code: line, name: '' });
    });
    return pairs;
  }

  function ensureKvedPairs(source) {
    if (Array.isArray(source?.kvedCodes) && source.kvedCodes.length) {
      return source.kvedCodes.map((pair) => ({ code: pair?.code || '', name: pair?.name || '' }));
    }
    return legacyKvedPairs(source);
  }

  function syncDraftKvedFields(pairs) {
    const normalized = pairs.length ? pairs.map((pair) => ({ code: pair?.code || '', name: pair?.name || '' })) : [{ code: '', name: '' }];
    draft.kvedCodes = normalized;
    const [main, ...extras] = normalized;
    draft.kvedMainCode = main?.code || '';
    draft.kvedMainName = main?.name || '';
    draft.kvedAdditional = extras.map((pair) => pair.code || pair.name ? `${pair.code}${pair.name ? ` — ${pair.name}` : ''}` : '').filter(Boolean).join('\n');
  }

  function normalizeHeaderName(value) {
    return String(value || '').trim().toLowerCase().replace(/[^а-яa-z0-9]+/g, '');
  }

  function findHeader(headers, candidates, fallbackIndex = null) {
    const normalizedHeaders = headers.map((header) => normalizeHeaderName(header));
    for (let index = 0; index < headers.length; index += 1) {
      const normalized = normalizedHeaders[index];
      if (!normalized) continue;
      const match = candidates.some((candidate) => {
        const normalizedCandidate = normalizeHeaderName(candidate);
        return normalized === normalizedCandidate || normalized.includes(normalizedCandidate) || normalizedCandidate.includes(normalized);
      });
      if (match) return headers[index];
    }
    if (fallbackIndex !== null && headers[fallbackIndex] !== undefined) return headers[fallbackIndex];
    return null;
  }

  function normalizeDateValue(value) {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'number') {
      const date = new Date((value - 25569) * 86400000);
      return date.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (!match) return '';
    const [, day, month, year] = match;
    const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
    return `${fullYear.toString().padStart(4, '0')}-${Number(month).toString().padStart(2, '0')}-${Number(day).toString().padStart(2, '0')}`;
  }

  function normalizeCurrencyValue(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return '';
    if (['uah', 'грн', 'гривня', 'гривні', 'hrivnia'].some((item) => raw.includes(item))) return 'UAH';
    if (['usd', 'долар', 'долари', 'us$', '$'].some((item) => raw.includes(item))) return 'USD';
    if (['eur', 'євро', 'euro'].some((item) => raw.includes(item))) return 'EUR';
    return '';
  }

  function normalizeKvedCode(value) {
    const raw = String(value ?? '').trim();
    return raw.replace(/^_+/, '').replace(/^\s+|\s+$/g, '');
  }

  function parseKvedImportRows(rows) {
    const headers = rows.length ? Object.keys(rows[0] || {}) : [];
    const codeHeader = findHeader(headers, ['код', 'кодквед', 'квед', 'kv', 'code', 'кодквeд'], 0);
    const nameHeader = findHeader(headers, ['назва', 'name', 'опис', 'description', 'desc', 'найменування'], 1);
    const mainHeader = findHeader(headers, ['основна', 'основний', 'main', 'primary', 'основнийкод'], 2);
    const pairs = [];
    let mainPair = null;
    rows.forEach((row) => {
      const code = normalizeKvedCode(row[codeHeader] ?? '');
      const name = String(row[nameHeader] ?? '').trim();
      const mainValue = String(row[mainHeader] ?? '').trim();
      if (!code && !name) return;
      const pair = { code, name };
      if (mainValue === '1' || mainValue.toLowerCase() === 'основна' || mainValue.toLowerCase() === 'main' || mainValue.toLowerCase() === 'primary') {
        mainPair = pair;
      } else {
        pairs.push(pair);
      }
    });
    if (mainPair) pairs.unshift(mainPair);
    return pairs.filter((pair) => pair.code || pair.name).length ? pairs.filter((pair) => pair.code || pair.name) : [{ code: '', name: '' }];
  }

  function parseAccountImportRows(rows) {
    const headers = rows.length ? Object.keys(rows[0] || {}) : [];
    const bankHeader = findHeader(headers, ['банк', 'bank', 'назвабанку', 'назварахунку'], 0);
    const codeHeader = findHeader(headers, ['мфо', 'кодбанку', 'bankcode', 'code'], 1);
    const currencyHeader = findHeader(headers, ['валюта', 'currency'], 2);
    const ibanHeader = findHeader(headers, ['iban', 'рахунок', 'номеррахунку', 'account', 'accountnumber'], 3);
    const openDateHeader = findHeader(headers, ['відкриття', 'opening', 'open', 'дата відкриття', 'dateopen'], 4) || findHeader(headers, ['дата', 'date']);
    return rows.map((row) => {
      const currency = normalizeCurrencyValue(row[currencyHeader] ?? '');
      return {
        bankName: String(row[bankHeader] ?? '').trim(),
        code: String(row[codeHeader] ?? '').trim(),
        currency,
        iban: String(row[ibanHeader] ?? '').trim(),
        openDate: normalizeDateValue(row[openDateHeader] ?? ''),
      };
    }).filter((account) => account.bankName || account.code || account.iban || account.openDate || account.currency);
  }

  function importKvedCodesFromFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const pairs = parseKvedImportRows(rows);
        syncDraftKvedFields(pairs);
        paint();
        window.showToast?.('Коди КВЕД імпортовано.', 'success', 4000);
      } catch (error) {
        console.error(error);
        window.showToast?.('Не вдалося імпортувати КВЕД з файлу.', 'error', 6000);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function importAccountsFromFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const imported = parseAccountImportRows(rows);
        draft.accounts = [...(draft.accounts || []), ...imported];
        paint();
        window.showToast?.('Рахунки імпортовано.', 'success', 4000);
      } catch (error) {
        console.error(error);
        window.showToast?.('Не вдалося імпортувати рахунки з файлу.', 'error', 6000);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function bodyHtml() {
    const d = draft;
    const total = [d.pricingBase, d.pricingStaff, d.pricingPrro].reduce((s, v) => s + (Number(v) || 0), 0);
    const rateOpts = RATE_OPTIONS[d.group] || RATE_OPTIONS['1'];
    const kvedPairs = ensureKvedPairs(d);
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
          <div class="cc-kved-list">
            ${kvedPairs.map((pair, index) => `
              <div class="cc-kved-pair ${index === 0 ? 'is-primary' : ''}" data-kved-index="${index}">
                <input class="cc-kved-code" data-kved-index="${index}" data-kved-field="code" value="${esc(pair.code || '')}" placeholder="99.99">
                <input class="cc-kved-name" data-kved-index="${index}" data-kved-field="name" value="${esc(pair.name || '')}" placeholder="Назва коду КВЕД">
              </div>
            `).join('')}
          </div>
          <button type="button" class="secondary cc-kved-add-btn" id="cc_addKved">+ Додати код КВЕД</button>
          <button type="button" class="secondary cc-kved-import-btn" id="cc_importKved">Імпорт</button>
          <input type="file" id="cc_importKvedFile" accept=".xlsx,.xls,.csv" hidden>
        </fieldset>
      </div>

      <fieldset class="cc-wide"><legend>Рахунки для підприємницької діяльності</legend>
        <table class="table cc-acc-table"><thead><tr>
          <th>Банк / Установа</th><th>Код</th><th>Валюта</th><th>IBAN</th><th>Дата відкриття</th><th></th>
        </tr></thead><tbody id="cc_accounts">${(d.accounts || []).map(accountRowHtml).join('')}</tbody></table>
        <button type="button" class="secondary" id="cc_addAccount" style="margin-top:8px">+ Рахунок</button>
        <button type="button" class="secondary cc-acc-import-btn" id="cc_importAccounts">Імпорт</button>
        <input type="file" id="cc_importAccountsFile" accept=".xlsx,.xls,.csv" hidden>
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
      'additionalInfo', 'rnokpp']
      .forEach((k) => { draft[k] = val(`cc_${k}`); });
    const kvedPairs = Array.from(overlay.querySelectorAll('.cc-kved-pair')).map((row) => ({
      code: row.querySelector('.cc-kved-code')?.value.trim() || '',
      name: row.querySelector('.cc-kved-name')?.value.trim() || '',
    })).filter((pair) => pair.code || pair.name);
    syncDraftKvedFields(kvedPairs.length ? kvedPairs : [{ code: '', name: '' }]);
    draft.group = document.getElementById('cc_group')?.value || draft.group;
    draft.rate = document.getElementById('cc_rate')?.value ?? draft.rate;
    draft.serviceCost = [draft.pricingBase, draft.pricingStaff, draft.pricingPrro].reduce((s, v) => s + (Number(v) || 0), 0);
  }

  function bindAccounts() {
    document.getElementById('cc_addAccount')?.addEventListener('click', () => {
      draft.accounts = draft.accounts || [];
      draft.accounts.push({});
      readForm();
      paint();
    });
    document.getElementById('cc_addKved')?.addEventListener('click', () => {
      readForm();
      const pairs = ensureKvedPairs(draft);
      pairs.push({ code: '', name: '' });
      syncDraftKvedFields(pairs);
      paint();
    });
    document.getElementById('cc_importKved')?.addEventListener('click', () => document.getElementById('cc_importKvedFile')?.click());
    document.getElementById('cc_importKvedFile')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) importKvedCodesFromFile(file);
      event.target.value = '';
    });
    document.getElementById('cc_importAccounts')?.addEventListener('click', () => document.getElementById('cc_importAccountsFile')?.click());
    document.getElementById('cc_importAccountsFile')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) importAccountsFromFile(file);
      event.target.value = '';
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
    const body = overlay.querySelector('.cc-body');
    const scrollTop = overlay.scrollTop;
    const scrollLeft = overlay.scrollLeft;
    const bodyScrollTop = body?.scrollTop || 0;
    const bodyScrollLeft = body?.scrollLeft || 0;
    overlay.innerHTML = `<div class="cc-window">
      <div class="cc-header">
        <div class="cc-title">${isNew ? 'Новий ФОП' : 'Картка клієнта'}</div>
        <button type="button" class="cc-close" data-cc-close title="Закрити">✕</button>
      </div>
      <div class="cc-body">${bodyHtml()}</div>
      <div class="cc-actions">
        ${!isNew ? `<button type="button" class="secondary" data-cc-hide>🗄 Приховати</button>
        <button type="button" class="danger" data-cc-delete>🗑 Видалити назавжди</button>` : ''}
        <span style="flex:1"></span>
        <button type="button" class="secondary" data-cc-close>Скасувати</button>
        <button type="button" class="primary" data-cc-save>Зберегти</button>
      </div>
    </div>`;

    bindAccounts();
    requestAnimationFrame(() => {
      overlay.scrollTop = scrollTop;
      overlay.scrollLeft = scrollLeft;
      const bodyEl = overlay.querySelector('.cc-body');
      if (bodyEl) {
        bodyEl.scrollTop = bodyScrollTop;
        bodyEl.scrollLeft = bodyScrollLeft;
      }
    });
    overlay.querySelectorAll('[data-cc-close]').forEach((b) => b.addEventListener('click', close));
    overlay.querySelector('[data-cc-save]')?.addEventListener('click', save);
    overlay.querySelector('[data-cc-hide]')?.addEventListener('click', () => {
      confirmHideClient(draft.id, () => close());
    });
    overlay.querySelector('[data-cc-delete]')?.addEventListener('click', () => {
      close();
      deleteClient(draft.id); // deleteClient() itself confirms + persists + re-renders
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
    const existing = isNew ? null : client(draft.id);
    if (existing) {
      Object.assign(existing, draft);
    } else {
      db.clients.push(draft);
      db.monthlyPayments[draft.id] = {};
    }
    persist();
    close();
    render(); // app.js's own render() — refreshes whichever tab is open
  }

  function close() {
    overlay.classList.remove('open');
    draft = null;
  }

  window.openClientCard = function (id) {
    const existing = id ? client(id) : null;
    isNew = !existing;
    draft = { ...FIELD_DEFAULTS, ...(existing || { id: uid(), form: 'ФОП', customFields: {} }) };
    draft.accounts = (draft.accounts || []).map((a) => ({ ...a }));
    draft.kvedCodes = ensureKvedPairs(draft);
    overlay.classList.add('open');
    paint();
  };
})();
