const QRCode = require('qrcode');

function qrValue(value) {
	return String(value || 'Not provided').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildDischargeQrText(discharge, patient, prescriptions = []) {
	const medicines = prescriptions
		.flatMap(prescription => JSON.parse(prescription.medicines || '[]'))
		.map(medicine => [medicine.name, medicine.dosage, medicine.frequency, medicine.duration].filter(Boolean).join(' '))
		.filter(Boolean);

	return [
		process.env.HOSPITAL_NAME || 'Hospital Discharge System',
		'DIGITAL DISCHARGE SUMMARY',
		`Discharge ID: ${qrValue(discharge.dischargeId)}`,
		`Status: ${qrValue(discharge.status)}`,
		'',
		`Patient: ${qrValue(patient.name)}`,
		`MRN: ${qrValue(patient.mrn)}`,
		`Age: ${qrValue(patient.age)}`,
		`Disease: ${qrValue(patient.disease)}`,
		`Tests: ${qrValue(patient.testDetails)}`,
		`Diagnosis: ${qrValue(discharge.diagnosis)}`,
		`Treatment: ${qrValue(discharge.treatment)}`,
		`Discharge instructions: ${qrValue(discharge.dischargeInstructions)}`,
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
