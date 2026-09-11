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
  if (result) result.textContent = '⏳ Running OCR extraction... Reading handwritten & printed text.';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Extracting data...'; }

  try {
    const payload = await apiRequest('/ocr/extract-preview', {
      method: 'POST',
      body: new FormData(form)
    });

    if (payload.parsedData) {
      applyParsedPatientData(payload.parsedData);
    }

    if (result) {
      result.innerHTML = '✅ <strong>Patient details extracted successfully via OCR!</strong><br><span style="font-size:12px;color:#51625f;">The form fields below have been populated. Please review and edit if needed.</span>';
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
  result.textContent = '⏳ Running OCR extraction... This may take a moment.';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Extracting medicines...'; }

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

const editorOcrForm = document.querySelector('#ocr-form:not([data-mode="autofill"])');
if (editorOcrForm) {
  editorOcrForm.addEventListener('submit', uploadPrescription);
}

function renderPrescription(prescription) {
  const container = document.querySelector('[data-prescription]');
  if (!container) return;
  container.dataset.id = prescription.id;
  container.innerHTML = `<p><strong>Raw OCR Text</strong></p><pre class="ocr-text">${escapeHtml(prescription.rawText || '')}</pre><p><strong>Extracted Medicines</strong></p><div data-medicines></div><button class="btn btn-primary" type="button" onclick="verifyPrescription()" style="margin-top:10px;">Verify medicines</button>`;
  const medicines = document.querySelector('[data-medicines]');
  medicines.innerHTML = prescription.parsedData.medicines.map((medicine, index) => `<div class="medicine-row" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;margin-bottom:8px;"><input data-medicine-name="${index}" value="${escapeAttribute(medicine.name)}" placeholder="Medicine Name" required><input data-medicine-dosage="${index}" value="${escapeAttribute(medicine.dosage)}" placeholder="Dosage"><input data-medicine-frequency="${index}" value="${escapeAttribute(medicine.frequency)}" placeholder="Frequency"><input data-medicine-duration="${index}" value="${escapeAttribute(medicine.duration)}" placeholder="Duration"></div>`).join('') || '<p>No medicines detected. Add them manually before verification.</p>';
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

/* ============================================================
   LONG IMAGE PREVIEW & INTERACTIVE TOOLS
   ============================================================ */

function syncCameraToMainInput(cameraInput) {
  if (cameraInput.files && cameraInput.files[0]) {
    const form = cameraInput.closest('form');
    const mainInput = form.querySelector('input[name="prescription"]');
    if (mainInput) {
      try {
        const dt = new DataTransfer();
        dt.items.add(cameraInput.files[0]);
        mainInput.files = dt.files;
        mainInput.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {
        // Fallback for older browsers
        handleFilePreviewChange({ target: cameraInput });
      }
    }
  }
}

function setupPrescriptionPreviews() {
  const fileInputs = document.querySelectorAll('input[type="file"][name="prescription"]');
  fileInputs.forEach(input => {
    input.addEventListener('change', handleFilePreviewChange);
  });
}

function handleFilePreviewChange(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  const form = input.closest('form');
  if (!form) return;

  // Look for existing preview card in this form, or create one
  let card = form.querySelector('.ocr-preview-card');
  if (!card) {
    card = document.createElement('div');
    card.className = 'ocr-preview-card';
    card.innerHTML = `
      <div class="ocr-preview-header">
        <div class="ocr-preview-info">
          <span style="font-size:16px;">📄</span>
          <span class="ocr-preview-name" data-filename>Prescription</span>
          <span class="ocr-preview-size" data-filesize></span>
        </div>
        <div class="ocr-preview-tools">
          <button type="button" class="btn-tool" onclick="rotatePreview(this)" title="Rotate 90 degrees">🔄 Rotate</button>
          <button type="button" class="btn-tool" onclick="toggleExpandPreview(this)" title="Toggle full-length vertical view">↕️ Full Length</button>
          <button type="button" class="btn-tool btn-tool-danger" onclick="clearPreview(this)" title="Remove this photo">✕ Remove</button>
        </div>
      </div>
      <div class="ocr-preview-scroll-wrap">
        <img class="ocr-preview-img" src="" alt="Prescription Document Preview" data-rotation="0">
      </div>
      <div class="ocr-preview-footer">
        🔍 <strong>High-Resolution Prescription Preview</strong> · Scroll to inspect full document or click "Full Length"
      </div>
    `;
    // Insert preview directly before submit button
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) {
      form.insertBefore(card, submitBtn);
    } else {
      form.appendChild(card);
    }
  }

  // Populate file data
  const filenameEl = card.querySelector('[data-filename]');
  const filesizeEl = card.querySelector('[data-filesize]');
  const imgEl = card.querySelector('.ocr-preview-img');

  if (filenameEl) filenameEl.textContent = file.name;
  if (filesizeEl) filesizeEl.textContent = formatBytes(file.size);

  const objectUrl = URL.createObjectURL(file);
  if (imgEl) {
    imgEl.src = objectUrl;
    imgEl.dataset.rotation = '0';
    imgEl.style.transform = 'rotate(0deg)';
  }

  card.style.display = 'block';

  // Smoothly scroll to preview on mobile
  setTimeout(() => {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function rotatePreview(btn) {
  const card = btn.closest('.ocr-preview-card');
  if (!card) return;
  const img = card.querySelector('.ocr-preview-img');
  if (!img) return;

  let rotation = parseInt(img.dataset.rotation || '0', 10);
  rotation = (rotation + 90) % 360;
  img.dataset.rotation = rotation;
  img.style.transform = `rotate(${rotation}deg)`;
}

function toggleExpandPreview(btn) {
  const card = btn.closest('.ocr-preview-card');
  if (!card) return;
  const wrap = card.querySelector('.ocr-preview-scroll-wrap');
  if (!wrap) return;

  const isExpanded = wrap.classList.toggle('expanded');
  btn.textContent = isExpanded ? '↕️ Fit Box' : '↕️ Full Length';
  btn.style.background = isExpanded ? 'var(--brand, #136f63)' : 'rgba(255, 255, 255, 0.12)';
}

function clearPreview(btn) {
  const card = btn.closest('.ocr-preview-card');
  const form = btn.closest('form');
  if (card) card.remove();
  if (form) {
    const input = form.querySelector('input[type="file"][name="prescription"]');
    if (input) input.value = '';
    const result = form.querySelector('[data-ocr-result]');
    if (result) result.textContent = '';
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPrescriptionPreviews);
} else {
  setupPrescriptionPreviews();
}
