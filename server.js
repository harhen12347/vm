const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { constants: fsConstants } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { createSiteAuth } = require('./src/site-auth');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const { VirtualFileSystem } = require('./src/vfs');
const { convertSldprtToStl, MAX_CAD_FILE_BYTES } = require('./src/cad-converter');
const { UbuntuVmManager, VM_VNC_WEBSOCKET_PORT } = require('./src/vm-manager');

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const siteAuth = createSiteAuth(process.env.SITE_PASSWORD, {
  secureCookie: process.env.NODE_ENV === 'production'
});
const dataPath = process.env.AETHER_DATA_DIR || path.join(os.homedir(), '.aether-desktop');
const files = new VirtualFileSystem(path.join(dataPath, 'aether-files.json'));
const vmManager = new UbuntuVmManager({ userDataPath: dataPath });
const MAX_VM_UPLOAD_BYTES = 128 * 1024 * 1024;
const vmAccessToken = randomBytes(32).toString('hex');
const staticFiles = new Map([
  ['/', path.join(__dirname, 'src', 'launcher.html')],
  ['/login', path.join(__dirname, 'src', 'site-login.html')],
  ['/login.html', path.join(__dirname, 'src', 'site-login.html')],
  ['/site-login.css', path.join(__dirname, 'src', 'site-login.css')],
  ['/site-login.js', path.join(__dirname, 'src', 'site-login.js')],
  ['/site-shell.css', path.join(__dirname, 'src', 'site-shell.css')],
  ['/site-shell.js', path.join(__dirname, 'src', 'site-shell.js')],
  ['/launcher.css', path.join(__dirname, 'src', 'launcher.css')],
  ['/slicer', path.join(__dirname, 'src', 'slicer.html')],
  ['/slicer.html', path.join(__dirname, 'src', 'slicer.html')],
  ['/slicer.css', path.join(__dirname, 'src', 'slicer.css')],
  ['/slicer.js', path.join(__dirname, 'src', 'slicer.js')],
  ['/printer-database.mjs', path.join(__dirname, 'src', 'printer-database.mjs')],
  ['/cura-engine-adapter.mjs', path.join(__dirname, 'src', 'cura-engine-adapter.mjs')],
  ['/printer-database.json', path.join(__dirname, 'src', 'printer-database.json')],
  ['/slicer-worker.js', path.join(__dirname, 'src', 'slicer-worker.js')],
  ['/cad', path.join(__dirname, 'src', 'cad.html')],
  ['/cad.html', path.join(__dirname, 'src', 'cad.html')],
  ['/printer-config', path.join(__dirname, 'src', 'printer-config.html')],
  ['/printer-config.html', path.join(__dirname, 'src', 'printer-config.html')],
  ['/printer-config.css', path.join(__dirname, 'src', 'printer-config.css')],
  ['/printer-config.js', path.join(__dirname, 'src', 'printer-config.js')],
  ['/printer-config-core.mjs', path.join(__dirname, 'src', 'printer-config-core.mjs')],
  ['/gx-converter', path.join(__dirname, 'src', 'gx-converter.html')],
  ['/gx-converter.html', path.join(__dirname, 'src', 'gx-converter.html')],
  ['/gx-converter.css', path.join(__dirname, 'src', 'gx-converter.css')],
  ['/gx-converter.js', path.join(__dirname, 'src', 'gx-converter.js')],
  ['/gx-converter-core.mjs', path.join(__dirname, 'src', 'gx-converter-core.mjs')],
  ['/gx-converter-worker.js', path.join(__dirname, 'src', 'gx-converter-worker.js')],
  ['/vendor/three/three.module.js', path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js')],
  ['/vendor/three/three.core.js', path.join(__dirname, 'node_modules', 'three', 'build', 'three.core.js')],
  ['/vendor/cura-wasm/es.js', path.join(__dirname, 'node_modules', '@toybox-labs', 'cura-wasm', 'dist', 'es.js')],
  ['/desktop', path.join(__dirname, 'src', 'index.html')],
  ['/desktop/', path.join(__dirname, 'src', 'index.html')],
  ['/desktop/styles.css', path.join(__dirname, 'src', 'styles.css')],
  ['/desktop/renderer.js', path.join(__dirname, 'src', 'renderer.js')],
  ['/styles.css', path.join(__dirname, 'src', 'styles.css')],
  ['/renderer.js', path.join(__dirname, 'src', 'renderer.js')],
  ['/cad.css', path.join(__dirname, 'src', 'cad.css')],
  ['/cad-page.js', path.join(__dirname, 'src', 'cad-page.js')],
  ['/cad-worker.js', path.join(__dirname, 'src', 'cad-worker.js')],
  ['/vendor/container/modern.js', require.resolve('sldprt/src/container/modern.js')],
  ['/vendor/container/ole.js', require.resolve('sldprt/src/container/ole.js')],
  ['/vendor/display.js', require.resolve('sldprt/src/display.js')],
  ['/vendor/inflate.js', require.resolve('sldprt/src/inflate.js')],
  ['/vendor/convert.js', require.resolve('sldprt/src/convert.js')]
]);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

async function readCadFile(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_CAD_FILE_BYTES) {
      throw Object.assign(new Error(`SLDPRT files must be ${MAX_CAD_FILE_BYTES / 1024 / 1024} MB or smaller.`), {
        statusCode: 413
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function validateSharedName(name) {
  if (typeof name !== 'string' || !name || name.length > 255 || name === '.' || name === '..'
      || /[\\/\0]/.test(name)) {
    throw Object.assign(new Error('Choose a single valid file name.'), { statusCode: 400 });
  }
  return name;
}

function requireVmToken(request) {
  const supplied = request.headers['x-aether-vm-token'];
  const expected = Buffer.from(vmAccessToken);
  if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== expected.length
      || !timingSafeEqual(Buffer.from(supplied), expected)) {
    throw Object.assign(new Error('Invalid VM request token.'), { statusCode: 403 });
  }
}

async function readVmUpload(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_VM_UPLOAD_BYTES) {
      throw Object.assign(new Error(`Shared files must be ${MAX_VM_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`), {
        statusCode: 413
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function listSharedFiles() {
  await fs.mkdir(vmManager.sharedPath, { recursive: true });
  const entries = await fs.readdir(vmManager.sharedPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stat = await fs.lstat(path.join(vmManager.sharedPath, entry.name)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) continue;
    if (!stat.isFile()) continue;
    files.push({ name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

async function handleApi(request, response, pathname) {
  if (pathname === '/api/auth/login') {
    if (request.method !== 'POST') return respondJson(response, 405, { error: 'Method not allowed.' });
    const body = await readJson(request);
    const forwarded = process.env.TRUST_PROXY === 'true' ? request.headers['x-forwarded-for']?.split(',')[0]?.trim() : '';
    const clientId = forwarded || request.socket.remoteAddress || 'unknown';
    const result = siteAuth.authenticate(body.password, clientId);
    if (result.limited) {
      response.setHeader('Retry-After', String(result.retryAfter));
      return respondJson(response, 429, { error: 'Too many unsuccessful attempts. Please wait before trying again.' });
    }
    if (!result.ok) return respondJson(response, 401, { error: 'Incorrect password. Please try again.' });
    response.setHeader('Set-Cookie', siteAuth.cookie(result.token));
    return respondJson(response, 200, { ok: true });
  }
  if (pathname === '/api/auth/logout') {
    if (request.method !== 'POST') return respondJson(response, 405, { error: 'Method not allowed.' });
    siteAuth.revoke(request);
    response.setHeader('Set-Cookie', siteAuth.clearCookie());
    return respondJson(response, 200, { ok: true });
  }
  if (pathname === '/api/auth/session') {
    if (request.method !== 'GET') return respondJson(response, 405, { error: 'Method not allowed.' });
    return respondJson(response, 200, { authenticated: siteAuth.hasSession(request) });
  }
  if (pathname === '/api/cad/sldprt-to-stl') {
    if (request.method !== 'POST') return respondJson(response, 405, { error: 'Method not allowed.' });
    if ((request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/octet-stream') {
      return respondJson(response, 415, { error: 'Upload an SLDPRT file as application/octet-stream.' });
    }
    const stl = await convertSldprtToStl(await readCadFile(request));
    response.writeHead(200, {
      'Content-Type': 'model/stl',
      'Content-Length': stl.length,
      'Content-Disposition': 'attachment; filename="converted.stl"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(stl);
    return;
  }
  if (pathname === '/api/health' && request.method === 'GET') {
    return respondJson(response, 200, { status: 'ok', name: 'Aether Browser VM' });
  }
  if (pathname === '/api/vm/status' && request.method === 'GET') {
    return respondJson(response, 200, { ...await vmManager.status(), csrfToken: vmAccessToken });
  }
  if (pathname === '/api/vm/download' && request.method === 'POST') {
    requireVmToken(request);
    return respondJson(response, 200, { ...await vmManager.downloadUbuntuIso(), csrfToken: vmAccessToken });
  }
  if (pathname === '/api/vm/start' && request.method === 'POST') {
    requireVmToken(request);
    return respondJson(response, 200, { ...await vmManager.start(), csrfToken: vmAccessToken });
  }
  if (pathname === '/api/vm/shutdown' && request.method === 'POST') {
    requireVmToken(request);
    await vmManager.requestShutdown();
    return respondJson(response, 200, { ok: true });
  }
  if (pathname === '/api/vm/shared' && request.method === 'GET') {
    return respondJson(response, 200, await listSharedFiles());
  }
  if (pathname === '/api/vm/shared/upload' && request.method === 'POST') {
    requireVmToken(request);
    if ((request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/octet-stream') {
      return respondJson(response, 415, { error: 'Upload a shared file as application/octet-stream.' });
    }
    const name = validateSharedName(new URL(request.url, 'http://localhost').searchParams.get('name'));
    await fs.mkdir(vmManager.sharedPath, { recursive: true });
    const filePath = path.join(vmManager.sharedPath, name);
    await fs.writeFile(filePath, await readVmUpload(request), { flag: 'wx', mode: 0o600 });
    return respondJson(response, 201, { ok: true, name });
  }
  if (pathname === '/api/vm/shared/download' && request.method === 'GET') {
    const name = validateSharedName(new URL(request.url, 'http://localhost').searchParams.get('name'));
    const filePath = path.join(vmManager.sharedPath, name);
    const handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      throw Object.assign(new Error('Shared file not found.'), { statusCode: 404 });
    }
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    await pipeline(handle.createReadStream(), response);
    return;
  }
  if (pathname === '/api/vm/shared/delete' && request.method === 'POST') {
    requireVmToken(request);
    const body = await readJson(request);
    await fs.unlink(path.join(vmManager.sharedPath, validateSharedName(body.name)));
    return respondJson(response, 200, { ok: true });
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
    const pathname = requestUrl.pathname;
    const publicPath = pathname === '/login' || pathname === '/login.html'
      || pathname === '/site-login.css' || pathname === '/site-login.js';
    const publicApi = pathname === '/api/auth/login' || pathname === '/api/auth/session'
      || pathname === '/api/health';

    if (pathname.startsWith('/api/') && !publicApi && !siteAuth.hasSession(request)) {
      respondJson(response, 401, { error: 'Authentication required.' });
      return;
    }
    if (!pathname.startsWith('/api/') && !publicPath && !siteAuth.hasSession(request)) {
      response.writeHead(303, { Location: `/login?next=${encodeURIComponent(pathname + requestUrl.search)}`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (pathname.startsWith('/api/')) {
      await handleApi(request, response, pathname);
      return;
    }
    if (publicPath && siteAuth.hasSession(request) && (pathname === '/login' || pathname === '/login.html')) {
      response.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    let filePath = staticFiles.get(pathname);
    const addonPrefix='/vendor/three/addons/';
    if(!filePath&&requestUrl.pathname.startsWith(addonPrefix)){
      const addonRoot=path.resolve(__dirname,'node_modules','three','examples','jsm');
      const requestedPath=path.resolve(addonRoot,requestUrl.pathname.slice(addonPrefix.length));
      if(requestedPath.startsWith(`${addonRoot}${path.sep}`))filePath=requestedPath;
    }
    if (request.method !== 'GET' || !filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const content = await fs.readFile(filePath);
    const isLoginPage = pathname === '/login' || pathname === '/login.html';
    const pageContent = path.extname(filePath) === '.html' && !isLoginPage
      ? Buffer.from(content.toString('utf8').replace('</body>', '<script src="/site-shell.js" defer></script></body>'))
      : content;
    const isSlicerRoute = requestUrl.pathname.startsWith('/slicer');
    const scriptPolicy = isSlicerRoute ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': isLoginPage ? 'no-store' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'self' https:; ${scriptPolicy}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src https: http:; object-src 'none'; base-uri 'self';`
    });
    response.end(pageContent);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const statusCode = error.statusCode || (error.code === 'ENOENT' || error.message.includes('not found')
      ? 404
      : error.code === 'EEXIST' ? 409 : 400);
    respondJson(response, statusCode, { error: error.message || 'Request failed.' });
  }
});

const consoleServer = new WebSocketServer({ noServer: true });
const consoleClients = new Set();
server.on('upgrade', (request, socket, head) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url, 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }
  const suppliedToken = requestUrl.searchParams.get('token') || '';
  if (requestUrl.pathname !== '/vm-ws' || !siteAuth.hasSession(request)
      || Buffer.byteLength(suppliedToken) !== Buffer.byteLength(vmAccessToken)
      || !timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(vmAccessToken))) {
    socket.destroy();
    return;
  }
  vmManager.status().then((status) => {
    if (!status.running) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    consoleServer.handleUpgrade(request, socket, head, (client) => {
      consoleServer.emit('connection', client, request);
    });
  }).catch(() => socket.destroy());
});

consoleServer.on('connection', (client) => {
  consoleClients.add(client);
  const upstream = new WebSocket(`ws://127.0.0.1:${VM_VNC_WEBSOCKET_PORT}/`, 'binary');
  const queuedMessages = [];
  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else queuedMessages.push({ data, isBinary });
  });
  upstream.on('open', () => {
    for (const message of queuedMessages.splice(0)) upstream.send(message.data, { binary: message.isBinary });
  });
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on('error', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'QEMU VNC console is unavailable.');
  });
  client.on('close', () => {
    consoleClients.delete(client);
    upstream.close();
  });
  client.on('error', () => upstream.close());
  upstream.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'QEMU VNC console closed.');
  });
});

server.listen(port, host, () => {
  console.log(`Aether Browser VM API listening at http://${host}:${port}`);
  console.log(`Persistent virtual files: ${pathToFileURL(path.join(dataPath, 'aether-files.json')).pathname}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const client of consoleClients) client.close(1001, 'VM server is shutting down.');
    vmManager.stop()
      .catch((error) => console.error(`Could not stop the Ubuntu VM: ${error.message}`))
      .finally(() => server.close(() => process.exit(0)));
  });
}
