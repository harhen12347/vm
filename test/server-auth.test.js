const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

async function getFreePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

test('server gates pages and APIs, retains sessions, and logs out', async t => {
  const port = await getFreePort();
  const dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-auth-test-'));
  const server = spawn(process.execPath, ['server.js'], {
	cwd: path.join(__dirname, '..'),
	env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SITE_PASSWORD: 'integration-test-secret', NODE_ENV: 'production', AETHER_DATA_DIR: dataPath },
	stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverError = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', chunk => { serverError += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  const request = (route, options = {}) => fetch(`${origin}${route}`, { redirect: 'manual', ...options });

  try {
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt += 1) {
	  if (server.exitCode !== null) throw new Error(`Server exited during startup: ${serverError}`);
	  try {
		const response = await request('/api/health');
		if (response.ok) { ready = true; break; }
	  } catch { }
	  await new Promise(resolve => setTimeout(resolve, 50));
	}
	assert.equal(ready, true, `Server failed to start: ${serverError}`);

	const loginPage = await request('/login');
	assert.equal(loginPage.status, 200);
	assert.match(await loginPage.text(), /site-password/);

	const protectedRoutes = ['/', '/desktop/', '/cad.html', '/slicer.html', '/printer-config.html', '/gx-converter.html'];
	for (const route of protectedRoutes) {
	  const protectedPage = await request(route);
	  assert.equal(protectedPage.status, 303, `${route} should redirect to login`);
	  assert.match(protectedPage.headers.get('location'), /^\/login\?next=/);
	}
	assert.equal((await request('/api/system')).status, 401);
	assert.equal((await request('/api/vm/status')).status, 401);
	assert.equal((await request('/api/files/list')).status, 401);

	const incorrect = await request('/api/auth/login', {
	  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'incorrect' })
	});
	assert.equal(incorrect.status, 401);
	assert.match((await incorrect.json()).error, /Incorrect password/);

	const correct = await request('/api/auth/login', {
	  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'integration-test-secret' })
	});
	assert.equal(correct.status, 200);
	const setCookie = correct.headers.get('set-cookie');
	assert.match(setCookie, /HttpOnly/);
	assert.match(setCookie, /SameSite=Strict/);
	assert.match(setCookie, /; Secure/);
	const cookie = setCookie.split(';')[0];

	for (const route of protectedRoutes) {
	  const protectedPage = await request(route, { headers: { Cookie: cookie } });
	  assert.equal(protectedPage.status, 200, `${route} should work after login`);
	  assert.match(await protectedPage.text(), /site-shell.js/);
	}
	const persistentSession = await request('/api/auth/session', { headers: { Cookie: cookie } });
	assert.equal(persistentSession.status, 200);
	assert.equal((await persistentSession.json()).authenticated, true);

	const logout = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
	assert.equal(logout.status, 200);
	assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
	const revokedSession = await request('/api/auth/session', { headers: { Cookie: cookie } });
	assert.equal((await revokedSession.json()).authenticated, false);
	assert.equal((await request('/api/system', { headers: { Cookie: cookie } })).status, 401);
	assert.equal((await request('/', { headers: { Cookie: cookie } })).status, 303);
  } finally {
	server.kill('SIGTERM');
	await new Promise(resolve => {
	  if (server.exitCode !== null) resolve();
	  else server.once('exit', resolve);
	});
	await fs.rm(dataPath, { recursive: true, force: true });
  }
});
