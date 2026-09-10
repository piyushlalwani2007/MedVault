const API_BASE_URL = window.HOSPITAL_API_URL || 'http://localhost:5000/api';

async function apiRequest(path, options = {}) {
	const token = localStorage.getItem('hospital_auth_token');
	const headers = new Headers(options.headers || {});

	if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
		headers.set('Content-Type', 'application/json');
	}
	if (token) headers.set('Authorization', `Bearer ${token}`);

	const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
	const payload = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(payload.error || 'Request failed');
	}

	return payload;
}
