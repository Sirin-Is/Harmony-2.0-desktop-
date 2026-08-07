// Prevents an additional console window from opening on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod credential_store {
    use std::{ptr::null_mut, slice};
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    const TARGET: &str = "Harmony/SupabaseSession/v1";
    const MAX_SESSION_BYTES: usize = 128 * 1024;

    fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
    fn error(error: windows::core::Error) -> String { error.message().to_string() }

    pub fn read() -> Result<Option<String>, String> {
        let target = wide(TARGET);
        let mut credential: *mut CREDENTIALW = null_mut();
        let result = unsafe { CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, Some(0), &mut credential) };
        if let Err(reason) = result {
            // ERROR_NOT_FOUND is an ordinary signed-out state.
            if reason.code().0 == -2147023728 { return Ok(None); }
            return Err(error(reason));
        }
        if credential.is_null() { return Err("Windows Credential Manager повернув порожній запис".to_string()); }
        let size = unsafe { (*credential).CredentialBlobSize as usize };
        if size > MAX_SESSION_BYTES {
            unsafe { CredFree(credential as _) };
            return Err("Збережена сесія завелика".to_string());
        }
        // Copy and release the native allocation before UTF-8 validation so an
        // invalid credential cannot bypass CredFree through an early return.
        let bytes = unsafe { slice::from_raw_parts((*credential).CredentialBlob, size) }.to_vec();
        unsafe { CredFree(credential as _); }
        String::from_utf8(bytes).map(Some).map_err(|reason| reason.to_string())
    }

    pub fn write(session: String) -> Result<(), String> {
        let target = wide(TARGET);
        let bytes = session.as_bytes();
        if bytes.len() > MAX_SESSION_BYTES { return Err("Сесія завелика".to_string()); }
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_ptr() as _),
            CredentialBlobSize: bytes.len().try_into().map_err(|_| "Сесія завелика".to_string())?,
            CredentialBlob: bytes.as_ptr() as _,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        unsafe { CredWriteW(&credential, 0) }.map_err(error)
    }

    pub fn clear() -> Result<(), String> {
        let target = wide(TARGET);
        match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, Some(0)) } {
            Ok(()) => Ok(()),
            Err(reason) if reason.code().0 == -2147023728 => Ok(()),
            Err(reason) => Err(error(reason)),
        }
    }
}

#[cfg(target_os = "windows")]
mod local_data_protection {
    use std::{fs, os::windows::ffi::OsStrExt, path::Path, sync::OnceLock};
    use tauri::{AppHandle, Manager};
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::EncryptFileW,
    };

    #[derive(Clone, serde::Serialize)]
    pub struct ProtectionStatus {
        pub enabled: bool,
        pub detail: String,
    }

    static STATUS: OnceLock<ProtectionStatus> = OnceLock::new();

    fn wide(value: &std::path::Path) -> Vec<u16> {
        value.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn encrypt(path: &Path) -> Result<(), String> {
        let path_wide = wide(path);
        unsafe { EncryptFileW(PCWSTR(path_wide.as_ptr())) }.map_err(|error| error.message().to_string())
    }

    fn is_sqlite_artifact(path: &Path) -> bool {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else { return false; };
        let name = name.to_ascii_lowercase();
        name.ends_with(".db") || name.ends_with(".db-wal") || name.ends_with(".db-shm") || name.ends_with(".db-journal")
    }

    /// Encrypt the directory and every existing SQLite artifact before the
    /// renderer opens the database. Encrypting the directory makes future WAL,
    /// SHM and journal files inherit EFS protection as they are created.
    fn protect(app: &AppHandle) -> ProtectionStatus {
        let path = match app.path().app_config_dir() {
            Ok(path) => path,
            Err(error) => return ProtectionStatus { enabled: false, detail: error.to_string() },
        };
        if let Err(error) = fs::create_dir_all(&path) {
            return ProtectionStatus { enabled: false, detail: error.to_string() };
        }
        if let Err(error) = encrypt(&path) {
            return ProtectionStatus { enabled: false, detail: error };
        }

        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(error) => return ProtectionStatus { enabled: false, detail: error.to_string() },
        };
        let mut protected_files = 0usize;
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => return ProtectionStatus { enabled: false, detail: error.to_string() },
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => return ProtectionStatus { enabled: false, detail: error.to_string() },
            };
            let file_path = entry.path();
            if !file_type.is_file() || !is_sqlite_artifact(&file_path) { continue; }
            if let Err(error) = encrypt(&file_path) {
                return ProtectionStatus {
                    enabled: false,
                    detail: format!("Не вдалося зашифрувати {}: {error}", file_path.display()),
                };
            }
            protected_files += 1;
        }

        ProtectionStatus { enabled: true, detail: format!("Windows EFS; захищено файлів SQLite: {protected_files}") }
    }

    pub fn initialize(app: &AppHandle) -> ProtectionStatus {
        let status = protect(app);
        let _ = STATUS.set(status.clone());
        status
    }

    pub fn status(app: &AppHandle) -> ProtectionStatus {
        STATUS.get().cloned().unwrap_or_else(|| initialize(app))
    }
}

#[tauri::command]
fn read_auth_session() -> Result<Option<String>, String> { credential_store::read() }

#[tauri::command]
fn write_auth_session(session: String) -> Result<(), String> { credential_store::write(session) }

#[tauri::command]
fn clear_auth_session() -> Result<(), String> { credential_store::clear() }

#[tauri::command]
fn restart_app(app: tauri::AppHandle) { app.restart(); }

#[cfg(target_os = "windows")]
#[tauri::command]
fn local_storage_protection_status(app: tauri::AppHandle) -> local_data_protection::ProtectionStatus {
    local_data_protection::status(&app)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let status = local_data_protection::initialize(app.handle());
                if !status.enabled { eprintln!("Local data protection is unavailable: {}", status.detail); }
            }
            Ok(())
        })
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![read_auth_session, write_auth_session, clear_auth_session, restart_app, local_storage_protection_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
