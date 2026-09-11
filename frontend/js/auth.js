function getStoredUser() {
	try { return JSON.parse(localStorage.getItem('hospital_user') || 'null'); } catch { return null; }
}

function requireAuthentication() {
	if (!localStorage.getItem('hospital_auth_token')) { window.location.href = 'login.html'; return false; }
	return true;
}

function logout() {
	localStorage.removeItem('hospital_auth_token');
	localStorage.removeItem('hospital_user');
	window.location.href = 'login.html';
}

async function handleLogin(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const error = document.querySelector('[data-error]');
	const btn = form.querySelector('[type="submit"]');
	const origText = btn ? btn.textContent : 'Sign In';

	if (error) {
		error.style.display = 'none';
		error.textContent = '';
	}
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Verifying credentials...';
	}

	try {
		const payload = await apiRequest('/auth/login', {
			method: 'POST',
			body: JSON.stringify({
				staffId: form.staffId.value.trim(),
				password: form.password.value
			})
		});
		localStorage.setItem('hospital_auth_token', payload.token);
		localStorage.setItem('hospital_user', JSON.stringify(payload.user));
		if (btn) btn.textContent = '✓ Access granted! Redirecting...';
		setTimeout(() => {
			window.location.href = 'dashboard.html';
		}, 300);
	} catch (requestError) {
		if (error) {
			error.style.display = 'block';
			error.textContent = requestError.message || 'Invalid Staff ID or password';
		}
		if (btn) {
			btn.disabled = false;
			btn.textContent = origText;
		}
	}
}
