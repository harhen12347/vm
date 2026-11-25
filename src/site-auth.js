const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');

const SESSION_COOKIE = 'aether_site_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const FAILED_LOGIN_WINDOW_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function getCookie(request, name = SESSION_COOKIE) {
  const cookieHeader = request.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
	const separator = part.indexOf('=');
	if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
	try {
	  return decodeURIComponent(part.slice(separator + 1).trim());
	} catch {
	  return '';
	}
  }
  return '';
}

function createSiteAuth(password, options = {}) {
  if (typeof password !== 'string' || password.length === 0) {
	throw new Error('SITE_PASSWORD must be set to a non-empty value before starting the web server.');
  }

  const sessions = new Map();
  const failedLogins = new Map();
  const expectedPasswordDigest = digest(password);
  const secureCookie = options.secureCookie === true;

  function hasSession(request) {
	const token = getCookie(request);
	if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
	const expiresAt = sessions.get(token);
	if (!expiresAt) return false;
	if (expiresAt <= Date.now()) {
	  sessions.delete(token);
	  return false;
	}
	return true;
  }

  function authenticate(candidate, clientId = 'unknown') {
	const now = Date.now();
	let attempts = failedLogins.get(clientId);
	if (attempts && attempts.expiresAt <= now) {
	  failedLogins.delete(clientId);
	  attempts = undefined;
	}
	if (failedLogins.size > 10000) {
	  for (const [key, value] of failedLogins) {
		if (value.expiresAt <= now) failedLogins.delete(key);
	  }
	  while (failedLogins.size > 10000) failedLogins.delete(failedLogins.keys().next().value);
	}
	if (attempts && attempts.count >= MAX_FAILED_LOGINS) {
	  return { ok: false, limited: true, retryAfter: Math.ceil((attempts.expiresAt - now) / 1000) };
	}

	const suppliedDigest = digest(typeof candidate === 'string' ? candidate : '');
	const valid = timingSafeEqual(expectedPasswordDigest, suppliedDigest);
	if (!valid) {
	  if (!attempts) attempts = { count: 0, expiresAt: now + FAILED_LOGIN_WINDOW_MS };
	  attempts.count += 1;
	  failedLogins.set(clientId, attempts);
	  return { ok: false, limited: false };
	}

	failedLogins.delete(clientId);
	const token = randomBytes(32).toString('hex');
	sessions.set(token, now + SESSION_TTL_MS);
	return { ok: true, token };
  }

  function revoke(request) {
	const token = getCookie(request);
	if (token) sessions.delete(token);
  }

  function cookie(token) {
	const secure = secureCookie ? '; Secure' : '';
	return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Strict${secure}`;
  }

  function clearCookie() {
	const secure = secureCookie ? '; Secure' : '';
	return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
  }

  return { hasSession, authenticate, revoke, cookie, clearCookie };
}

module.exports = { createSiteAuth, SESSION_COOKIE };
