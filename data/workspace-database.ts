export const LEGACY_DATABASE_URL = 'sqlite:harmony.db';
export const LOCAL_DATABASE_URL = 'sqlite:harmony-local.db';

const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map an authenticated workspace to one path-safe SQLite file. */
export function workspaceDatabaseUrl(workspaceId: string | null): string {
  if (workspaceId === null) return LOCAL_DATABASE_URL;
  const normalized = String(workspaceId).trim().toLowerCase();
  if (!WORKSPACE_ID_PATTERN.test(normalized)) throw new Error('Некоректний ідентифікатор робочого простору Harmony.');
  return `sqlite:harmony-workspace-${normalized}.db`;
}
