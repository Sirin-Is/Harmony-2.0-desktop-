export function isValidIsoDate(value = '') {
  const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return false;
  const date = new Date(`${value}T00:00:00`);
  return date.getFullYear() === Number(parts[1]) && date.getMonth() + 1 === Number(parts[2]) && date.getDate() === Number(parts[3]);
}

export const shortDate = (iso = '') => isValidIsoDate(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '';

/** Week-view calendar icon used consistently in every date input. */
export const calendarDateIconSvg = '<svg class="calendar-date-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4M17 2v4M3 8h18M7 12h10M7 16h10"/></svg>';

export function shortDateToIso(value = '') {
  const parts = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!parts) return null;
  const iso = `${parts[3]}-${parts[2]}-${parts[1]}`;
  const date = new Date(`${iso}T00:00:00`);
  return date.getFullYear() === Number(parts[3]) && date.getMonth() + 1 === Number(parts[2]) && date.getDate() === Number(parts[1]) ? iso : null;
}

export function enhanceDateInputs(root = document) {
  root.querySelectorAll('input[type="date"]:not(.payroll-native-date):not(.date-native)').forEach((native) => {
    native.classList.add('date-native');
    const wrapper = document.createElement('span'); wrapper.className = 'generic-date-control';
    native.parentNode.insertBefore(wrapper, native); wrapper.appendChild(native);
    const text = document.createElement('input');
    text.type = 'text'; text.inputMode = 'numeric'; text.maxLength = 10; text.placeholder = 'дд.мм.рррр'; text.value = shortDate(native.value); text.className = 'generic-date-field';
    text.setAttribute('aria-label', native.getAttribute('aria-label') || 'Дата');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'generic-date-picker'; button.innerHTML = calendarDateIconSvg; button.title = 'Відкрити календар'; button.setAttribute('aria-label', 'Відкрити календар');
    wrapper.prepend(text); wrapper.appendChild(button);
    const syncFieldWidth = () => {
      const probe = document.createElement('canvas').getContext('2d');
      const style = getComputedStyle(text);
      probe.font = style.font;
      const value = text.value || text.placeholder;
      wrapper.style.setProperty('--date-text-width', `${Math.ceil(probe.measureText(value).width)}px`);
    };
    requestAnimationFrame(syncFieldWidth);
    text.addEventListener('input', () => {
      const digitsBefore = text.value.slice(0, text.selectionStart || 0).replace(/\D/g, '').length;
      const digits = text.value.replace(/\D/g, '').slice(0, 8);
      text.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.');
      const cursor = digitsBefore <= 2 ? digitsBefore : digitsBefore <= 4 ? digitsBefore + 1 : digitsBefore + 2;
      text.setSelectionRange(cursor, cursor);
      syncFieldWidth();
      if (digits.length === 8) { const iso = shortDateToIso(text.value); if (iso) { native.value = iso; native.dispatchEvent(new Event('change', { bubbles: true })); } }
    });
    text.addEventListener('change', () => { if (!text.value) { native.value = ''; native.dispatchEvent(new Event('change', { bubbles: true })); } else if (!shortDateToIso(text.value)) text.value = shortDate(native.value); syncFieldWidth(); });
    native.addEventListener('change', () => { text.value = shortDate(native.value); syncFieldWidth(); });
    button.addEventListener('click', () => { if (typeof native.showPicker === 'function') native.showPicker(); else native.click(); });
  });
}
