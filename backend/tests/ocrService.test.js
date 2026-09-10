const test = require('node:test');
const assert = require('node:assert/strict');
const ocrService = require('../services/ocrService');

test('uses local OCR when Google Vision is not configured', () => {
  const previousKey = process.env.GOOGLE_VISION_API_KEY;
  delete process.env.GOOGLE_VISION_API_KEY;

  try {
    assert.equal(ocrService.getPreferredProvider(), 'local');
  } finally {
    if (previousKey) {
      process.env.GOOGLE_VISION_API_KEY = previousKey;
    }
  }
});

test('extracts hospital discharge fields from realistic OCR text', () => {
  const rawText = `
  DISCHARGE SUMMARY
  Patient Name: Aisha Khan
  Age / Sex: 32 / Female
  Existing MRN: HOSP-10234
  Diagnosis: Acute bronchitis
  Admission Date: 05/09/2026
  Tests: CBC, Chest X-ray, ECG
  Follow up Advice: Rest, hydration, review in 3 days
  `;

  const parsed = ocrService.parseDischargeDocumentData(rawText);

  assert.equal(parsed.patientName, 'Aisha Khan');
  assert.equal(parsed.patientAge, '32');
  assert.equal(parsed.patientMRN, 'HOSP-10234');
  assert.equal(parsed.patientDisease, 'Acute bronchitis');
  assert.match(parsed.admissionDate, /05\/09\/2026|05-09-2026/);
  assert.match(parsed.testDetails, /CBC|Chest X-ray|ECG/);
});

test('extracts treatment and discharge instructions from plain discharge-plan wording', () => {
  const rawText = `
    DISCHARGE SUMMARY
    Patient Name: John Mathew
    Age: 45
    Existing MRN: MRN-5541
    Diagnosis: Viral fever
    Admission Date: 07/09/2026
    Tests: CBC, CRP
    Treatment Plan: Oral hydration, paracetamol 500 mg twice daily for 3 days.
    Discharge Advice: Take rest, drink plenty of fluids, and report worsening fever or breathing difficulty.
  `;

  const parsed = ocrService.parseDischargeDocumentData(rawText);

  assert.equal(parsed.patientName, 'John Mathew');
  assert.equal(parsed.patientDisease, 'Viral fever');
  assert.match(parsed.treatment, /paracetamol|oral hydration/i);
  assert.match(parsed.dischargeInstructions, /drink plenty of fluids|rest|breathing difficulty/i);
});
