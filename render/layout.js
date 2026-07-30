// render/layout.js
// Presentation-only helpers shared by every view: the generic table
// shell (with a sticky header), an empty-state message, and the
// synced top-scrollbar that sits above wide/tall tables.

export function empty(message) {
  return `<p class="empty">${message}</p>`;
}

/** Wrap pre-rendered <tr> strings in a table with sticky headers (see .table th in styles.css). */
export function table(rows, headings) {
  if (!rows.length) return empty('Записів поки немає.');
  const ths = headings.map((heading) => `<th>${heading}</th>`).join('');
  return `<div class="table-wrap"><table class="table"><thead><tr>${ths}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

/**
 * For every `.table-wrap` currently in #content, insert (or reuse) a thin
 * horizontal scrollbar directly above it, synced in both directions with
 * the table's own scroll position. Only shown when the table actually
 * overflows horizontally.
 */
export function setupTopScrollbars() {
  document.querySelectorAll('#content .table-wrap').forEach((wrap) => {
    const tableEl = wrap.querySelector('table');
    if (!tableEl) return;
    let bar = wrap.previousElementSibling;
    if (!bar || !bar.classList.contains('top-scrollbar')) {
      bar = document.createElement('div');
      bar.className = 'top-scrollbar';
      bar.innerHTML = '<div class="top-scrollbar-inner"></div>';
      wrap.parentNode.insertBefore(bar, wrap);
    }
    const needsScroll = tableEl.scrollWidth > wrap.clientWidth + 1;
    bar.style.display = needsScroll ? 'block' : 'none';
    if (!needsScroll) return;
    bar.style.width = `${wrap.clientWidth}px`;
    bar.querySelector('.top-scrollbar-inner').style.width = `${tableEl.scrollWidth}px`;
    if (!bar.dataset.bound) {
      bar.addEventListener('scroll', () => { wrap.scrollLeft = bar.scrollLeft; });
      wrap.addEventListener('scroll', () => { bar.scrollLeft = wrap.scrollLeft; });
      bar.dataset.bound = '1';
    }
    bar.scrollLeft = wrap.scrollLeft;
  });
}

let resizeBound = false;
/** Call once at bootstrap: keep top-scrollbars in sync when the window is resized. */
export function bindTopScrollbarResize() {
  if (resizeBound) return;
  window.addEventListener('resize', () => setupTopScrollbars());
  resizeBound = true;
}
