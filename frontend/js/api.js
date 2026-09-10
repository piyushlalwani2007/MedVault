const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const deployedApiUrl = 'https://medvault-6tj3.onrender.com/api';
const API_BASE_URL = window.HOSPITAL_API_URL || (isLocalDevelopment ? 'http://localhost:5000/api' : deployedApiUrl);

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
