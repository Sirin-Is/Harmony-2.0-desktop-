// Small, pure policy for transient local SQLite write failures.

export const MAX_TRANSIENT_SAVE_RETRIES = 3;

export function isTransientLocalWriteError(error) {
  return /database is locked|sqlite_busy|\bbusy\b/i.test(String(error?.message || error || ''));
}

/** Exponential backoff: 0.5 s, 1 s, then 2 s. */
export function localSaveRetryDelay(attempt) {
  return 500 * (2 ** Math.max(0, Math.min(Number(attempt) || 1, MAX_TRANSIENT_SAVE_RETRIES) - 1));
}
