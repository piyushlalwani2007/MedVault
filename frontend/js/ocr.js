function applyParsedPatientData(parsedData = {}) {
  const fieldMap = {
    patientName: 'patientName',
    patientAge: 'patientAge',
    patientMRN: 'patientMRN',
    patientDisease: 'patientDisease',
    testDetails: 'testDetails',
    admissionDate: 'admissionDate',
    diagnosis: 'diagnosis',
    treatment: 'treatment',
    dischargeInstructions: 'dischargeInstructions'
  };

  Object.entries(fieldMap).forEach(([sourceKey, targetName]) => {
    const fieldValue = parsedData[sourceKey] || '';
    const target = document.querySelector(`[name="${targetName}"]`);
    if (target && fieldValue) {
      target.value = fieldValue;
    }
  });
}

async function extractPrescriptionToForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector('[data-ocr-error]');
  const result = document.querySelector('[data-ocr-result]');
  const submitBtn = form.querySelector('[type="submit"]');
  const originalLabel = submitBtn ? submitBtn.textContent : '';

  if (error) error.textContent = '';
  if (result) result.textContent = 'Running OCR extraction... This may take a moment.';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Extracting...'; }

  try {
    const payload = await apiRequest('/ocr/extract-preview', {
      method: 'POST',
      body: new FormData(form)
    });

    if (payload.parsedData) {
      applyParsedPatientData(payload.parsedData);
    }

    if (result) {
      result.textContent = 'Patient details extracted via OCR. Review and edit before saving the discharge.';
    }
  } catch (requestError) {
    if (result) result.textContent = '';
    if (error) error.textContent = requestError.message;
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
  }
}

async function uploadPrescription(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector('[data-ocr-error]');
  const result = document.querySelector('[data-ocr-result]');
  const submitBtn = form.querySelector('[type="submit"]');
  const originalLabel = submitBtn ? submitBtn.textContent : '';
  error.textContent = '';
  result.textContent = 'Running OCR extraction... This may take a moment.';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Extracting...'; }

  try {
    const payload = await apiRequest('/ocr/extract', {
      method: 'POST',
      body: new FormData(form)
    });
    result.textContent = `Extracted ${payload.prescription.parsedData.medicines.length} medicine(s) via OCR. Review them below before verification.`;
    renderPrescription(payload.prescription);
  } catch (requestError) {
    result.textContent = '';
    error.textContent = requestError.message;
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
  }
}

if (document.querySelector('[data-mode="autofill"]')) {
  document.querySelector('[data-mode="autofill"]').addEventListener('submit', extractPrescriptionToForm);
}

function renderPrescription(prescription) {
  const container = document.querySelector('[data-prescription]');
  container.dataset.id = prescription.id;
  container.innerHTML = `<p><strong>Raw text</strong></p><pre class="ocr-text">${escapeHtml(prescription.rawText || '')}</pre><p><strong>Medicines</strong></p><div data-medicines></div><button class="btn btn-primary" type="button" onclick="verifyPrescription()">Verify medicines</button>`;
  const medicines = document.querySelector('[data-medicines]');
  medicines.innerHTML = prescription.parsedData.medicines.map((medicine, index) => `<div class="medicine-row"><input data-medicine-name="${index}" value="${escapeAttribute(medicine.name)}" required><input data-medicine-dosage="${index}" value="${escapeAttribute(medicine.dosage)}" placeholder="Dosage"><input data-medicine-frequency="${index}" value="${escapeAttribute(medicine.frequency)}" placeholder="Frequency"><input data-medicine-duration="${index}" value="${escapeAttribute(medicine.duration)}" placeholder="Duration"></div>`).join('') || '<p>No medicines detected. Add them manually before verification.</p>';
}

async function loadOcrHistory(dischargeId) {
  try {
    const payload = await apiRequest(`/ocr/history/${encodeURIComponent(dischargeId)}`);
    const latest = payload.prescriptions[payload.prescriptions.length - 1];
    if (latest) renderPrescription({ ...latest, parsedData: { medicines: latest.medicines } });
  } catch (error) {
    const target = document.querySelector('[data-ocr-error]');
    if (target) target.textContent = error.message;
  }
}

async function verifyPrescription() {
  const container = document.querySelector('[data-prescription]');
  const medicines = [...container.querySelectorAll('[data-medicine-name]')].map((input, index) => ({
    name: input.value.trim(),
    dosage: container.querySelector(`[data-medicine-dosage="${index}"]`).value.trim(),
    frequency: container.querySelector(`[data-medicine-frequency="${index}"]`).value.trim(),
    duration: container.querySelector(`[data-medicine-duration="${index}"]`).value.trim()
  })).filter(medicine => medicine.name);

  await apiRequest('/ocr/verify', {
    method: 'POST',
    body: JSON.stringify({ prescriptionId: container.dataset.id, verifiedData: { medicines } })
  });
  document.querySelector('[data-ocr-result]').textContent = 'Prescription verified successfully.';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
