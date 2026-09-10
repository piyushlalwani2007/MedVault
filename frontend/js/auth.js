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
	try {
		const payload = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ staffId: form.staffId.value.trim(), password: form.password.value }) });
		localStorage.setItem('hospital_auth_token', payload.token);
		localStorage.setItem('hospital_user', JSON.stringify(payload.user));
		window.location.href = 'dashboard.html';
	} catch (requestError) { error.textContent = requestError.message; }
}
