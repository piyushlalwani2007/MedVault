const QRCode = require('qrcode');

function qrValue(value) {
	return String(value || 'Not provided').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
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

	const medicines = list
		.flatMap(prescription => parseMeds(prescription.medicines))
		.map(medicine => [medicine.name, medicine.dosage, medicine.frequency, medicine.duration].filter(Boolean).join(' '))
		.filter(Boolean);

	return [
		process.env.HOSPITAL_NAME || 'Hospital Discharge System',
		'DIGITAL DISCHARGE SUMMARY',
		`Discharge ID: ${qrValue(d.dischargeId)}`,
		`Status: ${qrValue(d.status)}`,
		'',
		`Patient: ${qrValue(p.name)}`,
		`MRN: ${qrValue(p.mrn)}`,
		`Age: ${qrValue(p.age)}`,
		`Disease: ${qrValue(p.disease)}`,
		`Tests: ${qrValue(p.testDetails)}`,
		`Diagnosis: ${qrValue(d.diagnosis)}`,
		`Treatment: ${qrValue(d.treatment)}`,
		`Discharge instructions: ${qrValue(d.dischargeInstructions)}`,
		`Medicines: ${medicines.length ? medicines.join('; ') : 'None listed'}`
	].join('\n');
}

async function generateDischargeQr(discharge, patient, prescriptions = []) {
	const payload = buildDischargeQrText(discharge, patient, prescriptions);

	return QRCode.toDataURL(payload, {
		errorCorrectionLevel: 'M',
		margin: 2,
		width: 320
	});
}

module.exports = { generateDischargeQr, buildDischargeQrText };
