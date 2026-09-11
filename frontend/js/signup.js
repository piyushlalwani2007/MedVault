async function handleSignup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector('[data-error]');
  const success = document.querySelector('[data-success]');
  const btn = form.querySelector('[type="submit"]');
  const origText = btn ? btn.textContent : 'Submit signup';

  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  if (success) {
    success.style.display = 'none';
    success.textContent = '';
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creating account...';
  }

  try {
    const payload = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });

    if (success) {
      success.style.display = 'block';
      success.innerHTML = `✅ <strong>${payload.message || 'Staff account created successfully!'}</strong><br><span style="font-size:12px;">Redirecting to sign-in portal...</span>`;
    }
    if (btn) btn.textContent = '✓ Account Created!';
    form.reset();

    setTimeout(() => {
      window.location.href = 'login.html';
    }, 1500);

  } catch (requestError) {
    if (error) {
      error.style.display = 'block';
      error.textContent = requestError.message || 'Could not complete registration. Please check fields.';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}
