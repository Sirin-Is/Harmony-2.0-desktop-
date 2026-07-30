import { defineConfig } from 'vite';

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  // корінь проєкту лишається тим самим (index.html у корені) — файли не переміщувались
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust/Tauri writes and locks binaries here while compiling. Vite must not watch it.
      ignored: ['**/src-tauri/target/**'],
    },
  },
  // не даємо Vite очищати термінал — інакше губляться помилки/логи з `cargo`/tauri
  clearScreen: false,
});
