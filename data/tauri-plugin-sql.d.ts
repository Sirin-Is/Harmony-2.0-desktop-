// Minimal API surface used by the local repository. The package supplies its
// own declarations after `npm install`; this keeps the project type-checkable
// while the desktop dependencies are being restored.
declare module '@tauri-apps/plugin-sql' {
  export default class Database {
    static load(path: string): Promise<Database>;
    execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
    select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  }
}
