async function loadDashboard() {
	if (!requireAuthentication()) return;
	const user = getStoredUser();
	document.querySelector('[data-user]').textContent = `${user.name} · ${user.role}`;
	try {
		const payload = await apiRequest('/discharge/all');
		const list = document.querySelector('[data-discharges]');
		list.innerHTML = payload.discharges.map(discharge => `<tr><td>${discharge.dischargeId}</td><td>${discharge.patientName || 'Unknown'}</td><td><span class="status">${discharge.status}</span></td><td><a class="btn btn-small" href="ocr-editor.html?id=${encodeURIComponent(discharge.id)}">Open</a></td></tr>`).join('') || '<tr><td colspan="4">No discharges found.</td></tr>';
	} catch (error) { document.querySelector('[data-error]').textContent = error.message; }
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
		if (!payload.results.length) {
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

	return `<section class="patient-result"><div class="patient-result-heading"><div><h3>${escapeHtml(patient.name)}</h3><p class="muted">MRN: ${escapeHtml(patient.mrn)} · Age: ${escapeHtml(patient.age)}</p></div><span class="patient-result-count">${record.discharges.length} visit${record.discharges.length === 1 ? '' : 's'}</span></div><p><strong>Current problem:</strong> ${escapeHtml(patient.disease || 'Not recorded')}</p><div class="history-list">${history || '<p class="muted">No previous discharge records found.</p>'}</div></section>`;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
