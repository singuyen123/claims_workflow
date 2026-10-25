import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API (npm run api) listens on 3000; the dev server proxies /api to it.
const api = { '/api': 'http://127.0.0.1:3000' };

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: api },
  preview: { port: 4173, proxy: api },
  // The large chunks are Mermaid's layout engines, loaded on demand by the state diagram.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
