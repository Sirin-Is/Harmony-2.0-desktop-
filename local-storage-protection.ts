import { invoke } from '@tauri-apps/api/core';

export type LocalStorageProtection = { enabled: boolean; detail: string };

/** Returns the Windows protection state without exposing any encryption key. */
export async function getLocalStorageProtection(): Promise<LocalStorageProtection> {
  if (!('__TAURI_INTERNALS__' in window)) return { enabled: false, detail: 'Доступно лише у встановленому застосунку Windows.' };
  return invoke<LocalStorageProtection>('local_storage_protection_status');
}
