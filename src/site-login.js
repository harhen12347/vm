const form = document.querySelector('#login-form');
const passwordInput = document.querySelector('#site-password');
const errorMessage = document.querySelector('#login-error');
const submitButton = document.querySelector('#login-button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  submitButton.disabled = true;
  try {
	const response = await fetch('/api/auth/login', {
	  method: 'POST',
	  headers: { 'Content-Type': 'application/json' },
	  credentials: 'same-origin',
	  body: JSON.stringify({ password: passwordInput.value })
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error || 'The password was not accepted.');
	const next = new URLSearchParams(location.search).get('next');
	const target = next ? new URL(next, location.origin) : new URL('/', location.origin);
	location.replace(target.origin === location.origin ? `${target.pathname}${target.search}${target.hash}` : '/');
  } catch (error) {
	errorMessage.textContent = error instanceof Error ? error.message : 'Unable to sign in. Please try again.';
	errorMessage.hidden = false;
	passwordInput.select();
	submitButton.disabled = false;
  }
});
