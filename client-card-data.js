(function (root) {
  function uid() {
    return (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createEmptyClientCard() {
    return {
      id: uid(),
      fullName: '',
      groupName: '',
      taxSystem: '',
      rnokpp: '',
      phone: '',
      telegram: '',
      email: '',
      source: '',
      contract: { fileName: '', link: '', number: '' },
      agreements: [],
      pricing: { base: '', additionalStaff: '', additionalPrro: '', total: '' },
      banks: [],
      staff: { count: '', status: '' },
      prro: [],
      cep: { issuer: '', validFrom: '', validTo: '' },
      registrationAddress: '',
      taxOffice: { code: '', name: '' },
      kved: { main: { code: '', name: '' }, additional: [] },
      accounts: [],
      additionalInfo: '',
      avatarUrl: '',
    };
  }

  function createDemoClientCard() {
    return {
      id: uid(),
      fullName: 'Павло Михайлович',
      groupName: '3 група / 5%',
      taxSystem: '5%',
      rnokpp: '12345678910',
      phone: '+38 (000) 000-00-00',
      telegram: 't.me/pavel',
      email: 'pavel@example.com',
      source: 'Рекомендація',
      contract: {
        fileName: 'Договір_2025.pdf',
        link: 'https://example.com/contract',
        number: 'UA-2025-001',
      },
      agreements: [
        { fileName: 'Додаткова угода №1.pdf', link: 'https://example.com/agreement-1' },
      ],
      pricing: { base: '12000', additionalStaff: '1500', additionalPrro: '800', total: '14300' },
      banks: ['MonoBank', 'PrivatBank'],
      staff: { count: '2', status: 'Активні' },
      prro: [{ name: 'РРО #1', count: '1' }],
      cep: { issuer: 'АЦСК "Кваліфікований підпис"', validFrom: '01.01.2025', validTo: '01.01.2026' },
      registrationAddress: 'м. Київ, вул. Хрещатик, 1',
      taxOffice: { code: '760', name: 'ДПІ м. Києва' },
      kved: {
        main: { code: '62.01', name: 'Розроблення програмного забезпечення' },
        additional: [
          { code: '47.91', name: 'Роздрібна торгівля' },
          { code: '70.22', name: 'Консультування з питань бізнесу' },
        ],
      },
      accounts: [
        { bankName: 'Monobank', code: '300123', currency: 'UAH', iban: 'UA000000000000000000000000', openDate: '12.03.2024' },
      ],
      additionalInfo: 'Клієнт потребує окремої уваги до термінів подання звітів.',
      avatarUrl: '',
    };
  }

  function createClientList() {
    return [
      {
        id: uid(),
        fullName: 'Павло Михайлович',
        groupName: '3 група / 5%',
        phone: '+38 (000) 000-00-00',
        telegram: 't.me/pavel',
        email: 'pavel@example.com',
        source: 'Рекомендація',
      },
      {
        id: uid(),
        fullName: 'Олена Іванівна',
        groupName: '1 група / 3%',
        phone: '+38 (111) 111-11-11',
        telegram: 't.me/elena',
        email: 'elena@example.com',
        source: 'Instagram',
      },
      {
        id: uid(),
        fullName: 'Максим Сергійович',
        groupName: '2 група / 5%',
        phone: '+38 (222) 222-22-22',
        telegram: 't.me/max',
        email: 'max@example.com',
        source: 'Сайт',
      },
    ];
  }

  function normalizeClientCard(data) {
    const base = createEmptyClientCard();
    const normalized = data && typeof data === 'object' ? data : {};
    return {
      ...base,
      ...normalized,
      contract: { ...base.contract, ...(normalized.contract || {}) },
      pricing: { ...base.pricing, ...(normalized.pricing || {}) },
      staff: { ...base.staff, ...(normalized.staff || {}) },
      cep: { ...base.cep, ...(normalized.cep || {}) },
      taxOffice: { ...base.taxOffice, ...(normalized.taxOffice || {}) },
      kved: {
        main: { ...base.kved.main, ...(normalized.kved?.main || {}) },
        additional: Array.isArray(normalized.kved?.additional)
          ? normalized.kved.additional
          : base.kved.additional,
      },
      accounts: Array.isArray(normalized.accounts) ? normalized.accounts : base.accounts,
      agreements: Array.isArray(normalized.agreements) ? normalized.agreements : base.agreements,
      banks: Array.isArray(normalized.banks) ? normalized.banks : base.banks,
      prro: Array.isArray(normalized.prro) ? normalized.prro : base.prro,
    };
  }

  root.HarmonyClientCardData = {
    createEmptyClientCard,
    createDemoClientCard,
    createClientList,
    normalizeClientCard,
  };
})(window);