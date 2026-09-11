const QRCode = require('qrcode');

function clipText(value, maxChars = 160) {
	const str = String(value || 'Not provided').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
	if (str.length > maxChars) {
		return str.slice(0, maxChars - 3) + '...';
	}
	return str;
}

function parseMeds(value) {
	if (Array.isArray(value)) return value;
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch (e) {
		return [];
	}
}

function buildDischargeQrText(discharge = {}, patient = {}, prescriptions = []) {
	const p = patient || {};
	const d = discharge || {};
	const list = Array.isArray(prescriptions) ? prescriptions : [];

	const allMeds = list.flatMap(prescription => parseMeds(prescription.medicines));
	const medEntries = allMeds.slice(0, 8).map(m => [m.name, m.dosage, m.frequency].filter(Boolean).join(' ')).filter(Boolean);
	let medicineText = medEntries.join('; ') || 'None listed';
	if (allMeds.length > 8) {
		medicineText += ` (+${allMeds.length - 8} more)`;
	}

	return [
		process.env.HOSPITAL_NAME || 'Hospital Discharge System',
		'DIGITAL DISCHARGE SUMMARY',
		`Discharge ID: ${clipText(d.dischargeId, 40)}`,
		`Status: ${clipText(d.status, 20)}`,
		'',
		`Patient: ${clipText(p.name, 60)}`,
		`MRN: ${clipText(p.mrn, 40)}`,
		`Age: ${clipText(p.age, 10)}`,
		`Diagnosis: ${clipText(d.diagnosis || p.disease, 160)}`,
		`Tests: ${clipText(p.testDetails, 160)}`,
		`Treatment: ${clipText(d.treatment, 160)}`,
		`Instructions: ${clipText(d.dischargeInstructions, 160)}`,
		`Medicines: ${clipText(medicineText, 250)}`
	].join('\n');
}

async function generateDischargeQr(discharge, patient, prescriptions = []) {
	let payload = buildDischargeQrText(discharge, patient, prescriptions);
	if (payload.length > 1500) {
		payload = payload.slice(0, 1497) + '...';
	}

	try {
		return await QRCode.toDataURL(payload, {
			errorCorrectionLevel: 'L',
			margin: 2,
			width: 320
		});
	} catch (e) {
		return await QRCode.toDataURL(payload.slice(0, 700) + '...', {
			errorCorrectionLevel: 'L',
			margin: 2,
			width: 320
		});
	}
}

module.exports = { generateDischargeQr, buildDischargeQrText };
