async function handleSignup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector('[data-error]');
  const success = document.querySelector('[data-success]');
  error.textContent = '';
  success.textContent = '';

  try {
    const payload = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    success.textContent = payload.message;
    form.reset();
  } catch (requestError) {
    error.textContent = requestError.message;
  }
}
