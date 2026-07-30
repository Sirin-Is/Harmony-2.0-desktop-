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

#[tauri::command]
fn read_auth_session() -> Result<Option<String>, String> { credential_store::read() }

#[tauri::command]
fn write_auth_session(session: String) -> Result<(), String> { credential_store::write(session) }

#[tauri::command]
fn clear_auth_session() -> Result<(), String> { credential_store::clear() }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![read_auth_session, write_auth_session, clear_auth_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
