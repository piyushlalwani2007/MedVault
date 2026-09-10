const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Patient = require('../models/Patient');
const db = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', authMiddleware, async (req, res, next) => {
	try {
		const {
			mrn, name, age, disease, testDetails, gender, bloodGroup,
			phone, email, address, emergencyContact
		} = req.body;

		if (!name || age === undefined || age === null || !disease || !testDetails) {
			return res.status(400).json({
				error: 'Name, age, disease, and test details are required'
			});
		}

		const numericAge = Number(age);
		if (!Number.isInteger(numericAge) || numericAge < 0 || numericAge > 150) {
			return res.status(400).json({ error: 'Age must be a valid whole number' });
		}

		const patient = await Patient.create(
			mrn || `MRN-${Date.now()}-${uuidv4().slice(0, 8)}`,
			name.trim(),
			numericAge,
			disease.trim(),
			testDetails.trim(),
			gender,
			bloodGroup,
			phone,
			email,
			address,
			emergencyContact
		);

		res.status(201).json({ success: true, patient });
	} catch (error) {
		next(error);
	}
});

router.get('/', authMiddleware, async (req, res, next) => {
	try {
		res.json({ success: true, patients: await Patient.getAll() });
	} catch (error) {
		next(error);
	}
});

router.get('/search', authMiddleware, (req, res, next) => {
	try {
		const query = String(req.query.q || '').trim();
		if (query.length < 2) {
			return res.status(400).json({ error: 'Enter at least 2 characters to search' });
		}

		const searchTerm = `%${query}%`;
		db.all(
			`SELECT * FROM patients
			 WHERE name LIKE ? OR mrn LIKE ? OR phone LIKE ?
			 ORDER BY updatedAt DESC, createdAt DESC
			 LIMIT 20`,
			[searchTerm, searchTerm, searchTerm],
			async (patientError, patients) => {
				if (patientError) return next(patientError);

				try {
					const history = await Promise.all(patients.map(patient => new Promise((resolve, reject) => {
						db.all(
							`SELECT d.*, GROUP_CONCAT(pr.medicines, '|||') AS prescriptionData
							 FROM discharges d
							 LEFT JOIN prescriptions pr ON pr.dischargeId = d.id
							 WHERE d.patientId = ?
							 GROUP BY d.id
							 ORDER BY d.createdAt DESC`,
							[patient.id],
							(dischargeError, discharges) => {
								if (dischargeError) return reject(dischargeError);
								resolve({
									patient,
									discharges: discharges.map(discharge => ({
										...discharge,
										prescriptions: String(discharge.prescriptionData || '')
											.split('|||')
											.filter(Boolean)
											.flatMap(value => {
												try {
													return JSON.parse(value);
												} catch (error) {
													return [];
												}
											})
									}))
								});
							}
						);
					})));
					res.json({ success: true, results: history });
				} catch (historyError) {
					next(historyError);
				}
			}
		);
	} catch (error) {
		next(error);
	}
});

router.get('/:id', authMiddleware, async (req, res, next) => {
	try {
		const patient = await Patient.findById(req.params.id);
		if (!patient) return res.status(404).json({ error: 'Patient not found' });
		res.json({ success: true, patient });
	} catch (error) {
		next(error);
	}
});

router.put('/:id', authMiddleware, async (req, res, next) => {
	try {
		const updates = { ...req.body };
		if (updates.age !== undefined) {
			updates.age = Number(updates.age);
			if (!Number.isInteger(updates.age) || updates.age < 0 || updates.age > 150) {
				return res.status(400).json({ error: 'Age must be a valid whole number' });
			}
		}
		for (const field of ['name', 'disease', 'testDetails']) {
			if (updates[field] !== undefined && !String(updates[field]).trim()) {
				return res.status(400).json({ error: `${field} cannot be empty` });
			}
			if (updates[field] !== undefined) updates[field] = String(updates[field]).trim();
		}

		const patient = await Patient.update(req.params.id, updates);
		if (!patient) return res.status(404).json({ error: 'Patient not found' });
		res.json({ success: true, patient });
	} catch (error) {
		next(error);
	}
});

module.exports = router;
