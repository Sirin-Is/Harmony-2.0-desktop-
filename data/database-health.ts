export interface LocalDatabaseHealth {
  ok: boolean;
  detail: string;
  checkedAt: string;
}

/** Convert SQLite PRAGMA quick_check rows into a stable UI-safe result. */
export function interpretSqliteCheck(rows: Array<Record<string, unknown>>): Omit<LocalDatabaseHealth, 'checkedAt'> {
  const findings = rows
    .flatMap((row) => Object.values(row))
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  if (!findings.length) return { ok: false, detail: 'SQLite не повернула результат перевірки.' };
  const ok = findings.every((value) => value.toLowerCase() === 'ok');
  return { ok, detail: ok ? 'Цілісність локальної бази підтверджено.' : findings.join(' · ') };
}
