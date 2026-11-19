const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { VirtualFileSystem } = require('./src/vfs');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const files = new VirtualFileSystem(path.join(os.homedir(), '.aether-desktop', 'aether-files.json'));
const staticFiles = new Map([
  ['/', path.join(__dirname, 'src', 'index.html')],
  ['/styles.css', path.join(__dirname, 'src', 'styles.css')],
  ['/renderer.js', path.join(__dirname, 'src', 'renderer.js')]
]);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function respondJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 12 * 1024 * 1024) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Expected a JSON request body.'), { statusCode: 400 });
  }
}

async function handleApi(request, response, pathname) {
  if (pathname === '/api/health' && request.method === 'GET') {
    return respondJson(response, 200, { status: 'ok', name: 'Aether Desktop' });
  }
  if (pathname === '/api/system' && request.method === 'GET') {
    return respondJson(response, 200, {
      platform: os.platform(),
      release: os.release(),
      cpuCount: os.cpus().length,
      cpuTimes: os.cpus().map((cpu) => cpu.times),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      appVersion: '1.0.0'
    });
  }

  const match = pathname.match(/^\/api\/files\/(list|read|write|mkdir|rename|delete)$/);
  if (!match) return respondJson(response, 404, { error: 'API route not found.' });

  const action = match[1];
  if (request.method === 'GET' && action === 'list') {
    const folderPath = new URL(request.url, 'http://localhost').searchParams.get('path') || '/';
    return respondJson(response, 200, await files.list(folderPath));
  }
  if (request.method === 'GET' && action === 'read') {
    const filePath = new URL(request.url, 'http://localhost').searchParams.get('path') || '/';
    return respondJson(response, 200, { content: await files.read(filePath) });
  }
  if (request.method !== 'POST') return respondJson(response, 405, { error: 'Method not allowed.' });

  const body = await readJson(request);
  if (action === 'write') await files.write(body.path, body.content);
  else if (action === 'mkdir') await files.mkdir(body.path);
  else if (action === 'rename') return respondJson(response, 200, { path: await files.rename(body.path, body.name) });
  else if (action === 'delete') await files.delete(body.path);
  else return respondJson(response, 404, { error: 'API route not found.' });
  return respondJson(response, 200, { ok: true });
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(request, response, requestUrl.pathname);
      return;
    }

    const filePath = staticFiles.get(requestUrl.pathname);
    if (request.method !== 'GET' || !filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self' https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src https: http:; object-src 'none'; base-uri 'self';"
    });
    response.end(content);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const statusCode = error.statusCode || (error.message.includes('not found') ? 404 : 400);
    respondJson(response, statusCode, { error: error.message || 'Request failed.' });
  }
});

server.listen(port, host, () => {
  console.log(`Aether Desktop listening at http://${host}:${port}`);
  console.log(`Persistent virtual files: ${pathToFileURL(path.join(os.homedir(), '.aether-desktop', 'aether-files.json')).pathname}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
