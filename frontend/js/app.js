async function loadDashboard() {
	if (!requireAuthentication()) return;
	const user = getStoredUser();
	const userNameEl = document.querySelector('[data-user-name]');
	if (userNameEl) userNameEl.textContent = user.name || 'Doctor';
	const userSubEl = document.querySelector('[data-user-sub]');
	if (userSubEl) userSubEl.innerHTML = `${escapeHtml(user.role || 'Doctor')} · ${escapeHtml(user.department || 'Hospital')} · <span id="today-date">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</span>`;
	const legacyUserEl = document.querySelector('[data-user]');
	if (legacyUserEl) legacyUserEl.textContent = `${user.name} · ${user.role}`;

	try {
		const payload = await apiRequest('/discharge/all');
		const discharges = payload.discharges || [];

		// Calculate stats
		const approvedCount = discharges.filter(d => d.status === 'Approved').length;
		const draftCount = discharges.filter(d => d.status === 'Draft').length;
		const cancelledCount = discharges.filter(d => d.status === 'Cancelled').length;

		const setStat = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
		setStat('[data-stat-approved]', approvedCount);
		setStat('[data-stat-draft]', draftCount);
		setStat('[data-stat-cancelled]', cancelledCount);
		setStat('[data-stat-total]', discharges.length);

		const list = document.querySelector('[data-discharges]');
		if (list) {
			list.innerHTML = discharges.map(discharge => {
				const statusClass = (discharge.status || 'draft').toLowerCase();
				return `
					<tr>
						<td><strong style="color:var(--brand-dark);font-family:var(--font-mono, monospace);">${escapeHtml(discharge.dischargeId)}</strong></td>
						<td><span style="font-weight:600;">${escapeHtml(discharge.patientName || 'Unknown')}</span></td>
						<td><span class="status-badge ${statusClass}">${escapeHtml(discharge.status)}</span></td>
						<td>
							<div class="action-btns">
								<a class="action-btn-review" href="ocr-editor.html?id=${encodeURIComponent(discharge.id)}">Review</a>
								<a class="action-btn-print" href="print-discharge.html?id=${encodeURIComponent(discharge.id)}">🖨️ Print</a>
							</div>
						</td>
					</tr>
				`;
			}).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px;">No discharges found. <a href="create-discharge.html" style="color:var(--brand);font-weight:600;">Create your first discharge</a>.</td></tr>';
		}
	} catch (error) {
		const errEl = document.querySelector('[data-error]');
		if (errEl) errEl.textContent = error.message;
	}
}

async function searchPatientHistory(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const query = new FormData(form).get('query').trim();
	const error = document.querySelector('[data-patient-search-error]');
	const results = document.querySelector('[data-patient-results]');
	if (error) error.textContent = '';
	if (query.length < 2) {
		if (error) error.textContent = 'Enter at least 2 characters.';
		return;
	}
	results.innerHTML = '<p class="muted">Searching patient history...</p>';

	try {
		const payload = await apiRequest(`/patients/search?q=${encodeURIComponent(query)}`);
		if (!payload.results || !payload.results.length) {
			results.innerHTML = '<p class="muted">No matching patient found.</p>';
			return;
		}
		results.innerHTML = payload.results.map(renderPatientHistory).join('');
	} catch (requestError) {
		results.innerHTML = '';
		if (error) error.textContent = requestError.message;
	}
}

function renderPatientHistory(record) {
	const patient = record.patient;
	const history = record.discharges.map(discharge => {
		const medicines = discharge.prescriptions.flatMap(prescription => prescription.medicines || []);
		const medicineText = medicines.map(medicine => [medicine.name, medicine.dosage, medicine.frequency, medicine.duration].filter(Boolean).join(' ')).join('; ');
		return `<article class="history-entry"><div class="history-entry-heading"><strong>${escapeHtml(discharge.diagnosis || 'Previous visit')}</strong><span class="status">${escapeHtml(discharge.status)}</span></div><p><strong>Admission:</strong> ${escapeHtml(discharge.admissionDate || 'Not recorded')}</p><p><strong>Treatment:</strong> ${escapeHtml(discharge.treatment || 'Not recorded')}</p><p><strong>Discharge instructions:</strong> ${escapeHtml(discharge.dischargeInstructions || 'Not recorded')}</p><p><strong>Prescriptions:</strong> ${escapeHtml(medicineText || 'None recorded')}</p></article>`;
	}).join('');

	return `<div class="patient-result"><div class="patient-result-heading"><div><h3>${escapeHtml(patient.name)}</h3><p class="muted">MRN: ${escapeHtml(patient.mrn)} · Age: ${escapeHtml(patient.age)} · Disease: ${escapeHtml(patient.disease)}</p></div><span class="patient-result-count">${record.discharges.length} record(s)</span></div><div class="history-list">${history || '<p class="muted">No discharge history found.</p>'}</div></div>`;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>'"]/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		"'": '&#39;',
		'"': '&quot;'
	}[character]));
}
