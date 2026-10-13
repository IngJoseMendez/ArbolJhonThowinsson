import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  // client/dist; scripts/build.js copia además a <raíz>/dist (lo que Vercel busca).
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
