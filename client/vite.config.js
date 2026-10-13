import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  // Se compila en <raíz>/dist: es lo que Vercel espera por defecto (y lo que declara vercel.json).
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
