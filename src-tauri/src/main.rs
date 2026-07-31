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
        let bytes = unsafe { slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize) };
        let value = String::from_utf8(bytes.to_vec()).map_err(|reason| reason.to_string())?;
        unsafe { CredFree(credential as _); }
        Ok(Some(value))
    }

    pub fn write(session: String) -> Result<(), String> {
        let target = wide(TARGET);
        let bytes = session.as_bytes();
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
    use std::{fs, os::windows::ffi::OsStrExt};
    use tauri::{AppHandle, Manager};
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::EncryptFileW,
    };

    #[derive(serde::Serialize)]
    pub struct ProtectionStatus {
        pub enabled: bool,
        pub detail: String,
    }

    fn wide(value: &std::path::Path) -> Vec<u16> {
        value.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    /// Encrypt the directory used by tauri-plugin-sql (AppConfig) before the
    /// renderer opens SQLite. EFS is transparent to SQLite and makes database,
    /// WAL and shared-memory files readable only in this Windows profile.
    pub fn protect(app: &AppHandle) -> ProtectionStatus {
        let path = match app.path().app_config_dir() {
            Ok(path) => path,
            Err(error) => return ProtectionStatus { enabled: false, detail: error.to_string() },
        };
        if let Err(error) = fs::create_dir_all(&path) {
            return ProtectionStatus { enabled: false, detail: error.to_string() };
        }
        let path_wide = wide(&path);
        match unsafe { EncryptFileW(PCWSTR(path_wide.as_ptr())) } {
            Ok(()) => ProtectionStatus { enabled: true, detail: "Windows EFS".into() },
            Err(error) => ProtectionStatus { enabled: false, detail: error.message().to_string() },
        }
    }
}

#[tauri::command]
fn read_auth_session() -> Result<Option<String>, String> { credential_store::read() }

#[tauri::command]
fn write_auth_session(session: String) -> Result<(), String> { credential_store::write(session) }

#[tauri::command]
fn clear_auth_session() -> Result<(), String> { credential_store::clear() }

#[cfg(target_os = "windows")]
#[tauri::command]
fn local_storage_protection_status(app: tauri::AppHandle) -> local_data_protection::ProtectionStatus {
    local_data_protection::protect(&app)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let status = local_data_protection::protect(app.handle());
                if !status.enabled { eprintln!("Local data protection is unavailable: {}", status.detail); }
            }
            Ok(())
        })
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![read_auth_session, write_auth_session, clear_auth_session, local_storage_protection_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
