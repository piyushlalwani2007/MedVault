const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRoles } = authMiddleware;
const Discharge = require('../models/Discharge');
const Patient = require('../models/Patient');
const qrService = require('../services/qrService');

const router = express.Router();

router.post('/create', authMiddleware, async (req, res) => {
  try {
    const {
      patientName, patientMRN, patientAge, patientDisease, testDetails, patientGender, bloodGroup,
      admissionDate, dischargeDate, diagnosis, treatment, dischargeInstructions
    } = req.body;

    if (!patientName || patientAge === undefined || !patientDisease || !testDetails || !diagnosis) {
      return res.status(400).json({
        error: 'Patient name, age, disease, test details, and diagnosis are required'
      });
    }

    const numericAge = Number(patientAge);
    if (!Number.isInteger(numericAge) || numericAge < 0 || numericAge > 150) {
      return res.status(400).json({ error: 'Patient age must be a valid whole number' });
    }

    // Create or get patient
    let patient = patientMRN ? await Patient.findByMRN(patientMRN) : null;
    if (!patient) {
      patient = await Patient.create(
        patientMRN || `MRN-${Date.now()}-${uuidv4().slice(0, 8)}`,
        patientName,
        numericAge,
        patientDisease,
        testDetails,
        patientGender,
        bloodGroup
      );
    }

    // Create discharge
    const discharge = await Discharge.create(
      patient.id,
      {
        admissionDate, dischargeDate, diagnosis, treatment, dischargeInstructions
      },
      req.user.id
    );

    res.json({
      success: true,
      discharge: {
        id: discharge.id,
        dischargeId: discharge.dischargeId,
        patientId: patient.id
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/all', authMiddleware, (req, res) => {
  try {
    db.all(
      `SELECT d.*, p.name as patientName, p.mrn FROM discharges d
       LEFT JOIN patients p ON d.patientId = p.id
       ORDER BY d.createdAt DESC`,
      (err, rows) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({ success: true, discharges: rows });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const discharge = await Discharge.findById(req.params.id);
    if (!discharge) {
      return res.status(404).json({ error: 'Discharge not found' });
    }

    const patient = await Patient.findById(discharge.patientId);
    db.all('SELECT * FROM prescriptions WHERE dischargeId = ?', [req.params.id], (err, prescriptions) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          const parsedPrescriptions = prescriptions.map(p => ({
            ...p,
            medicines: JSON.parse(p.medicines || '[]')
          }));
          res.json({ success: true, discharge, patient, prescriptions: parsedPrescriptions });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/qr', authMiddleware, async (req, res) => {
  try {
    const discharge = await Discharge.findById(req.params.id);
    if (!discharge) return res.status(404).json({ error: 'Discharge not found' });
    if (discharge.status !== 'Approved' || !discharge.qrCode) {
      return res.status(409).json({ error: 'QR code is available after approval' });
    }

    const patient = await Patient.findById(discharge.patientId);
    const prescriptions = await new Promise((resolve, reject) => {
      db.all('SELECT medicines FROM prescriptions WHERE dischargeId = ?', [req.params.id], (error, rows) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });
    const qrCode = await qrService.generateDischargeQr(discharge, patient, prescriptions);
    await Discharge.update(req.params.id, { qrCode });
    res.json({ success: true, qrCode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authMiddleware, requireRoles('Doctor', 'Nurse', 'Admin'), async (req, res) => {
  try {
    const discharge = await Discharge.findById(req.params.id);
    if (!discharge) return res.status(404).json({ error: 'Discharge not found' });
    if (discharge.status !== 'Draft') {
      return res.status(409).json({ error: 'Only draft discharges can be edited' });
    }

    const updates = {
      admissionDate: req.body.admissionDate,
      dischargeDate: req.body.dischargeDate,
      diagnosis: req.body.diagnosis,
      treatment: req.body.treatment,
      dischargeInstructions: req.body.dischargeInstructions
    };
    if (!updates.diagnosis) return res.status(400).json({ error: 'Diagnosis is required' });
    await Discharge.update(req.params.id, updates);
    res.json({ success: true, discharge: await Discharge.findById(req.params.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/approve/:id', authMiddleware, requireRoles('Doctor', 'Nurse', 'Admin'), async (req, res) => {
  try {
    const discharge = await Discharge.findById(req.params.id);
    if (!discharge) return res.status(404).json({ error: 'Discharge not found' });
    if (discharge.status !== 'Draft') {
      return res.status(409).json({ error: 'Only draft discharges can be approved' });
    }

    const patient = await Patient.findById(discharge.patientId);
    const prescriptions = await new Promise((resolve, reject) => {
      db.all('SELECT medicines FROM prescriptions WHERE dischargeId = ?', [req.params.id], (error, rows) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });

    const updates = {
      status: 'Approved',
      approvedById: req.user.id
    };

    await Discharge.update(req.params.id, updates);
    const approvedDischarge = { ...discharge, ...updates };
    const qrCode = await qrService.generateDischargeQr(approvedDischarge, patient, prescriptions);
    await Discharge.update(req.params.id, { qrCode });
    res.json({ success: true, message: 'Discharge approved', qrCode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/cancel/:id', authMiddleware, requireRoles('Doctor', 'Nurse', 'Admin'), async (req, res) => {
  try {
    const discharge = await Discharge.findById(req.params.id);
    if (!discharge) return res.status(404).json({ error: 'Discharge not found' });
    if (discharge.status !== 'Draft') {
      return res.status(409).json({ error: 'Only draft discharges can be cancelled' });
    }

    await Discharge.update(req.params.id, { status: 'Cancelled' });
    res.json({ success: true, message: 'Discharge cancelled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;