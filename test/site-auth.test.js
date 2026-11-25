const test = require('node:test');
const assert = require('node:assert/strict');
const { createSiteAuth, SESSION_COOKIE } = require('../src/site-auth');

function requestWithCookie(cookie) {
  return { headers: { cookie } };
}

test('requires a server-configured password', () => {
  assert.throws(() => createSiteAuth(''), /SITE_PASSWORD must be set/);
});

test('authenticates server-side and issues a secure HttpOnly SameSite cookie', () => {
  const auth = createSiteAuth('local-test-password', { secureCookie: true });
  assert.equal(auth.authenticate('wrong', 'client-1').ok, false);
  const result = auth.authenticate('local-test-password', 'client-1');
  assert.equal(result.ok, true);

  const cookie = auth.cookie(result.token);
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /; Secure/);
  assert.equal(auth.hasSession(requestWithCookie(cookie.split(';')[0])), true);
});

test('revokes sessions and rate-limits repeated failures', () => {
  const auth = createSiteAuth('local-test-password');
  let result;
  for (let attempt = 0; attempt < 5; attempt += 1) result = auth.authenticate('wrong', 'client-2');
  assert.equal(result.limited, false);
  assert.equal(auth.authenticate('wrong', 'client-2').limited, true);

  const sessionAuth = createSiteAuth('another-test-password');
  const session = sessionAuth.authenticate('another-test-password', 'client-3');
  const request = requestWithCookie(sessionAuth.cookie(session.token));
  assert.equal(sessionAuth.hasSession(request), true);
  sessionAuth.revoke(request);
  assert.equal(sessionAuth.hasSession(request), false);
});
