import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// WDAC/AppLocker can prohibit Rust's transient build executables inside
// Documents. Keep Cargo artifacts in a user-local cache instead. The value
// may be overridden for CI or a managed corporate location.
const windowsLocalAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
const defaultTarget = process.platform === 'win32'
  ? join(windowsLocalAppData, 'Harmony', 'cargo-target')
  : join(homedir(), '.cache', 'harmony', 'cargo-target');
const cargoTarget = process.env.HARMONY_CARGO_TARGET_DIR || defaultTarget;
const executable = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
const tauriArgs = process.argv.slice(2);
const windowsCommand = `call node_modules\\.bin\\tauri.cmd ${tauriArgs.join(' ')}`;

const child = process.platform === 'win32'
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', windowsCommand], {
    stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: cargoTarget },
  })
  : spawn(executable, tauriArgs, {
  stdio: 'inherit',
  env: { ...process.env, CARGO_TARGET_DIR: cargoTarget },
});

child.on('error', (error) => {
  console.error(`Не вдалося запустити Tauri CLI: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
