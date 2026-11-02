const form = document.querySelector('#loginForm');
const errorMessage = document.querySelector('#loginError');
const submitButton = document.querySelector('#submitButton');

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorMessage.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Verifying…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.elements.username.value,
        password: form.elements.password.value,
      }),
    });
    if (!response.ok) throw new Error('Sign-in failed. Check your username and password.');
    window.location.assign('/');
  } catch (error) {
    errorMessage.textContent = error.message || 'Unable to sign in. Try again.';
    submitButton.disabled = false;
    submitButton.innerHTML = 'Authenticate <span aria-hidden="true">↗</span>';
    form.elements.password.focus();
  }
});
