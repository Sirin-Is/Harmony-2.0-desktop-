export const shortDate = (iso = '') => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '';

export function shortDateToIso(value = '') {
  const parts = String(value).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!parts) return null;
  const iso = `20${parts[3]}-${parts[2]}-${parts[1]}`;
  const date = new Date(`${iso}T00:00:00`);
  return date.getFullYear() === Number(`20${parts[3]}`) && date.getMonth() + 1 === Number(parts[2]) && date.getDate() === Number(parts[1]) ? iso : null;
}

export function enhanceDateInputs(root = document) {
  root.querySelectorAll('input[type="date"]:not(.payroll-native-date):not(.date-native)').forEach((native) => {
    native.classList.add('date-native');
    const wrapper = document.createElement('span'); wrapper.className = 'generic-date-control';
    native.parentNode.insertBefore(wrapper, native); wrapper.appendChild(native);
    const text = document.createElement('input');
    text.type = 'text'; text.inputMode = 'numeric'; text.maxLength = 8; text.placeholder = 'дд.мм.рр'; text.value = shortDate(native.value); text.className = 'generic-date-field';
    text.setAttribute('aria-label', native.getAttribute('aria-label') || 'Дата');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'generic-date-picker'; button.textContent = '🗓'; button.title = 'Відкрити календар'; button.setAttribute('aria-label', 'Відкрити календар');
    wrapper.prepend(text); wrapper.appendChild(button);
    text.addEventListener('input', () => {
      const digitsBefore = text.value.slice(0, text.selectionStart || 0).replace(/\D/g, '').length;
      const digits = text.value.replace(/\D/g, '').slice(0, 6);
      text.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join('.');
      const cursor = digitsBefore <= 2 ? digitsBefore : digitsBefore <= 4 ? digitsBefore + 1 : digitsBefore + 2;
      text.setSelectionRange(cursor, cursor);
      if (digits.length === 6) { const iso = shortDateToIso(text.value); if (iso) { native.value = iso; native.dispatchEvent(new Event('change', { bubbles: true })); } }
    });
    text.addEventListener('change', () => { if (!text.value) { native.value = ''; native.dispatchEvent(new Event('change', { bubbles: true })); } else if (!shortDateToIso(text.value)) text.value = shortDate(native.value); });
    native.addEventListener('change', () => { text.value = shortDate(native.value); });
    button.addEventListener('click', () => { if (typeof native.showPicker === 'function') native.showPicker(); else native.click(); });
  });
}
