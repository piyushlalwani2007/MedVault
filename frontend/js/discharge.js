async function createDischarge(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const submitBtn = form.querySelector('[type="submit"]');
	const errorEl = document.querySelector('[data-error]');
	if (errorEl) errorEl.textContent = '';
	if (submitBtn) {
		submitBtn.disabled = true;
		submitBtn.textContent = 'Saving draft...';
	}

	try {
		const payload = await apiRequest('/discharge/create', {
			method: 'POST',
			body: JSON.stringify(Object.fromEntries(new FormData(form)))
		});
		window.location.href = `ocr-editor.html?id=${encodeURIComponent(payload.discharge.id)}`;
	} catch (error) {
		if (errorEl) errorEl.textContent = error.message;
		if (submitBtn) {
			submitBtn.disabled = false;
			submitBtn.textContent = 'Save draft';
		}
	}
}

function renderApprovedQr(id, qrCodeUrl) {
	const qrPanel = document.querySelector('[data-qr-panel]');
	const qrImg = document.querySelector('[data-approved-qr]');
	const printCardBtn = document.querySelector('[data-print-card-btn]');
	const printLink = document.querySelector('[data-print]');
	const printAction = document.querySelector('[data-print-action]');

	if (printCardBtn) printCardBtn.href = `print-discharge.html?id=${encodeURIComponent(id)}`;
	if (printLink) printLink.href = `print-discharge.html?id=${encodeURIComponent(id)}`;
	if (printAction) printAction.href = `print-discharge.html?id=${encodeURIComponent(id)}`;

	if (qrImg && qrCodeUrl) {
		qrImg.src = qrCodeUrl;
		qrImg.style.display = 'block';
	}
	if (qrPanel) {
		qrPanel.style.display = 'block';
	}
}

async function loadEditor() {
	if (!requireAuthentication()) return;
	const id = new URLSearchParams(window.location.search).get('id');
	if (!id) return;

	try {
		const payload = await apiRequest(`/discharge/${encodeURIComponent(id)}`);
		const discharge = payload.discharge;

		document.querySelector('[data-discharge-id]').textContent = discharge.dischargeId;
		document.querySelector('[data-status]').textContent = discharge.status;

		['admissionDate', 'dischargeDate', 'diagnosis', 'treatment', 'dischargeInstructions'].forEach(field => {
			const input = document.querySelector(`[name="${field}"]`);
			if (input) input.value = discharge[field] || '';
		});

		document.querySelectorAll('[data-action]').forEach(button => { button.dataset.id = id; });

		const printLink = document.querySelector('[data-print]');
		if (printLink) printLink.href = `print-discharge.html?id=${encodeURIComponent(id)}`;
		const printAction = document.querySelector('[data-print-action]');
		if (printAction) printAction.href = `print-discharge.html?id=${encodeURIComponent(id)}`;

		if (discharge.status !== 'Draft') {
			document.querySelectorAll('[data-draft-action]').forEach(element => { element.disabled = true; });
		}

		// If approved, show QR code
		let qrCode = discharge.qrCode || sessionStorage.getItem(`qr-${id}`);
		if (!qrCode && discharge.status === 'Approved') {
			try {
				const qrPayload = await apiRequest(`/discharge/${encodeURIComponent(id)}/qr`);
				if (qrPayload && qrPayload.qrCode) {
					qrCode = qrPayload.qrCode;
				}
			} catch (qrErr) {
				console.warn('Could not auto-fetch QR:', qrErr);
			}
		}

		if (discharge.status === 'Approved' && qrCode) {
			renderApprovedQr(id, qrCode);
		}

		if (typeof loadOcrHistory === 'function') loadOcrHistory(id);
	} catch (err) {
		const errorEl = document.querySelector('[data-editor-error]');
		if (errorEl) {
			errorEl.style.color = '#b42318';
			errorEl.textContent = `Failed to load discharge: ${err.message}`;
		}
	}
}

async function saveDischarge() {
	const btn = document.querySelector('[data-save]');
	const id = btn ? btn.dataset.id : new URLSearchParams(window.location.search).get('id');
	const errorEl = document.querySelector('[data-editor-error]');
	if (errorEl) errorEl.textContent = '';

	const origText = btn ? btn.textContent : '';
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Saving changes...';
	}

	try {
		await apiRequest(`/discharge/${encodeURIComponent(id)}`, {
			method: 'PUT',
			body: JSON.stringify(Object.fromEntries(new FormData(document.querySelector('#editor-form'))))
		});
		if (errorEl) {
			errorEl.style.color = '#2c7a54';
			errorEl.textContent = '✅ Changes saved successfully.';
		}
	} catch (err) {
		if (errorEl) {
			errorEl.style.color = '#b42318';
			errorEl.textContent = err.message;
		}
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.textContent = origText;
		}
	}
}

async function changeDischargeState(action) {
	const btn = document.querySelector(`[data-${action}]`);
	const id = (btn && btn.dataset.id) || new URLSearchParams(window.location.search).get('id');
	const errorEl = document.querySelector('[data-editor-error]');
	if (errorEl) errorEl.textContent = '';

	if (!id) {
		if (errorEl) errorEl.textContent = 'Missing discharge ID';
		return;
	}

	const origText = btn ? btn.textContent : '';
	if (btn) {
		btn.disabled = true;
		btn.textContent = action === 'approve' ? 'Approving & Generating QR...' : 'Cancelling...';
	}

	try {
		const endpoint = action === 'approve' ? 'approve' : 'cancel';
		const payload = await apiRequest(`/discharge/${endpoint}/${encodeURIComponent(id)}`, { method: 'POST' });

		if (payload.qrCode) {
			sessionStorage.setItem(`qr-${id}`, payload.qrCode);
			renderApprovedQr(id, payload.qrCode);
		}

		// Update status and disable draft actions
		const newStatus = action === 'approve' ? 'Approved' : 'Cancelled';
		const statusEl = document.querySelector('[data-status]');
		if (statusEl) statusEl.textContent = newStatus;

		document.querySelectorAll('[data-draft-action]').forEach(el => { el.disabled = true; });

		if (errorEl) {
			errorEl.style.color = action === 'approve' ? '#2c7a54' : '#b42318';
			errorEl.textContent = action === 'approve'
				? '✅ Discharge approved successfully! Digital verification QR code is generated above.'
				: 'Discharge record cancelled.';
		}
	} catch (err) {
		if (btn) {
			btn.disabled = false;
			btn.textContent = origText;
		}
		if (errorEl) {
			errorEl.style.color = '#b42318';
			errorEl.textContent = err.message;
		}
	}
}
