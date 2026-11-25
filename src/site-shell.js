const logoutButton = document.createElement('button');
logoutButton.type = 'button';
logoutButton.className = 'site-logout';
logoutButton.textContent = 'Log out';
logoutButton.setAttribute('aria-label', 'Log out of Aether Tools');
document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="/site-shell.css">');
document.body.append(logoutButton);

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
	await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
	location.replace('/login');
  } catch {
	logoutButton.disabled = false;
  }
});

window.addEventListener('pageshow', async () => {
  try {
	const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
	const session = await response.json();
	if (!session.authenticated) location.replace('/login');
  } catch {
	location.replace('/login');
  }
});
