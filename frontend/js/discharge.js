async function createDischarge(event) {
	event.preventDefault();
	const form = event.currentTarget;
	try {
		const payload = await apiRequest('/discharge/create', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
		window.location.href = `ocr-editor.html?id=${encodeURIComponent(payload.discharge.id)}`;
	} catch (error) { document.querySelector('[data-error]').textContent = error.message; }
}

async function loadEditor() {
	if (!requireAuthentication()) return;
	const id = new URLSearchParams(window.location.search).get('id');
	if (!id) return;
	const payload = await apiRequest(`/discharge/${encodeURIComponent(id)}`);
	const discharge = payload.discharge;
	document.querySelector('[data-discharge-id]').textContent = discharge.dischargeId;
	document.querySelector('[data-status]').textContent = discharge.status;
	['admissionDate', 'dischargeDate', 'diagnosis', 'treatment', 'dischargeInstructions'].forEach(field => { const input = document.querySelector(`[name="${field}"]`); if (input) input.value = discharge[field] || ''; });
	document.querySelectorAll('[data-action]').forEach(button => { button.dataset.id = id; });
	const printLink = document.querySelector('[data-print]');
	if (printLink) printLink.href = `print-discharge.html?id=${encodeURIComponent(id)}`;
	const printAction = document.querySelector('[data-print-action]');
	if (printAction) printAction.href = `print-discharge.html?id=${encodeURIComponent(id)}`;
	if (discharge.status !== 'Draft') document.querySelectorAll('[data-draft-action]').forEach(element => { element.disabled = true; });
	if (typeof loadOcrHistory === 'function') loadOcrHistory(id);
}

async function saveDischarge() {
	const id = document.querySelector('[data-save]').dataset.id;
	await apiRequest(`/discharge/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(document.querySelector('#editor-form')))) });
	window.location.reload();
}

async function changeDischargeState(action) {
	const id = document.querySelector(`[data-${action}]`).dataset.id;
	const endpoint = action === 'approve' ? 'approve' : 'cancel';
	const payload = await apiRequest(`/discharge/${endpoint}/${encodeURIComponent(id)}`, { method: 'POST' });
	if (payload.qrCode) sessionStorage.setItem(`qr-${id}`, payload.qrCode);
	window.location.reload();
}
