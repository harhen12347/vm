const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { VirtualFileSystem } = require('./src/vfs');
const { convertSldprtToStl, MAX_CAD_FILE_BYTES } = require('./src/cad-converter');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const files = new VirtualFileSystem(path.join(os.homedir(), '.aether-desktop', 'aether-files.json'));
const staticFiles = new Map([
  ['/', path.join(__dirname, 'src', 'launcher.html')],
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

async function handleApi(request, response, pathname) {
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

    let filePath = staticFiles.get(requestUrl.pathname);
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
    const isSlicerRoute = requestUrl.pathname.startsWith('/slicer');
    const scriptPolicy = isSlicerRoute ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'self' https:; ${scriptPolicy}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src https: http:; object-src 'none'; base-uri 'self';`
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
