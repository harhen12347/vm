import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = 'http://127.0.0.1:3001';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/vm-ws': { target: backend, changeOrigin: true, ws: true },
      '/slicer': { target: backend, changeOrigin: true },
      '/cad': { target: backend, changeOrigin: true },
      '/desktop': { target: backend, changeOrigin: true },
      '/vendor': { target: backend, changeOrigin: true },
      '/launcher.css': { target: backend, changeOrigin: true },
      '/styles.css': { target: backend, changeOrigin: true },
      '/renderer.js': { target: backend, changeOrigin: true },
      '/printer-database.json': { target: backend, changeOrigin: true },
      '/printer-database.mjs': { target: backend, changeOrigin: true },
      '/cura-engine-adapter.mjs': { target: backend, changeOrigin: true },
      '/slicer-worker.js': { target: backend, changeOrigin: true },
      '/cad-page.js': { target: backend, changeOrigin: true }
    }
  },
  build: {
    outDir: '../web-dist',
    emptyOutDir: true
  }
});
