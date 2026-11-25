import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = 'http://127.0.0.1:3001';

function siteSessionGate() {
  return {
    name: 'aether-site-session-gate',
    transformIndexHtml(html, context) {
      if (!context.server) return html;
      return html.replace('</body>', '<script src="/site-shell.js" defer></script></body>');
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname === '/login' || pathname === '/login.html' || pathname === '/site-login.css'
            || pathname === '/site-login.js' || pathname === '/api/auth/login' || pathname === '/api/auth/session') {
          next();
          return;
        }
        fetch(`${backend}/api/auth/session`, { headers: { cookie: request.headers.cookie || '' } })
          .then(result => result.json())
          .then(session => {
            if (!session.authenticated) {
              response.writeHead(303, { Location: `/login?next=${encodeURIComponent(request.url)}`, 'Cache-Control': 'no-store' });
              response.end();
              return;
            }
            next();
          })
          .catch(() => {
            response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end('Authentication server unavailable.');
          });
      });
    }
  };
}

export default defineConfig({
  root: 'web',
  plugins: [siteSessionGate(), react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/login': { target: backend, changeOrigin: true },
      '/login.html': { target: backend, changeOrigin: true },
      '/site-login.css': { target: backend, changeOrigin: true },
      '/site-login.js': { target: backend, changeOrigin: true },
      '/site-shell.css': { target: backend, changeOrigin: true },
      '/site-shell.js': { target: backend, changeOrigin: true },
      '/gx-converter': { target: backend, changeOrigin: true },
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
