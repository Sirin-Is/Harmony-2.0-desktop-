// toast.js
// Minimal, dependency-free toast notifications. Replaces blocking alert()
// calls for non-critical messages (import summaries, save confirmations,
// recoverable errors) so the user isn't forced to click "OK" to continue.

let container = null;

function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'toast-stack';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

/**
 * Show a transient notification.
 * @param {string} message
 * @param {'info'|'success'|'warn'|'error'} type
 * @param {number} duration ms before auto-dismiss (0 = stays until clicked)
 */
export function showToast(message, type = 'info', duration = 4000) {
  const root = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.addEventListener('click', () => toast.remove());
  root.appendChild(toast);
  if (duration > 0) {
    setTimeout(() => toast.remove(), duration);
  }
  return toast;
}
