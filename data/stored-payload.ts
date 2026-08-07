/** Active domain rows must contain JSON objects. Silently skipping corruption
 * would let the next full-snapshot save turn a recoverable row into deletion. */
export function parseStoredObjectPayload<T>(payload: string, section: string): T {
  try {
    const value = JSON.parse(payload) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as T;
  } catch {
    throw new Error(`Локальна база містить пошкоджений запис у розділі: ${section}. Відновіть дані з резервної копії.`);
  }
}
