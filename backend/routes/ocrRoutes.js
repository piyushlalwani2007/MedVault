const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ocrService = require('../services/ocrService');
const db = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');
const Discharge = require('../models/Discharge');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/prescriptions');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${extension}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload JPG, JPEG, PNG, or WEBP.'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.post('/extract-preview', authMiddleware, upload.single('prescription'), async (req, res) => {
  let uploadedPath;
  try {
    uploadedPath = req.file?.path;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ocrResult = await ocrService.extractFromPrescription(req.file.path);

    if (!ocrResult.success) {
      fs.unlink(uploadedPath, () => {});
      return res.status(400).json({ error: ocrResult.error });
    }

    fs.unlink(uploadedPath, () => {});
    return res.json({
      success: true,
      rawText: ocrResult.rawText,
      parsedData: ocrResult.parsedData,
      confidence: ocrResult.confidence
    });
  } catch (error) {
    if (uploadedPath) fs.unlink(uploadedPath, () => {});
    res.status(500).json({ error: error.message });
  }
});

router.post('/extract', authMiddleware, upload.single('prescription'), async (req, res) => {
  let uploadedPath;
  try {
    const { dischargeId } = req.body;
    uploadedPath = req.file?.path;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!dischargeId) {
      const ocrResult = await ocrService.extractFromPrescription(req.file.path);
      fs.unlink(uploadedPath, () => {});
      if (!ocrResult.success) {
        return res.status(400).json({ error: ocrResult.error });
      }
      return res.json({
        success: true,
        prescription: {
          id: uuidv4(),
          rawText: ocrResult.rawText,
          parsedData: ocrResult.parsedData,
          confidence: ocrResult.confidence
        }
      });
    }

    const discharge = await Discharge.findById(dischargeId);
    if (!discharge) {
      fs.unlink(uploadedPath, () => {});
      return res.status(404).json({ error: 'Discharge not found' });
    }
    if (discharge.status !== 'Draft') {
      fs.unlink(uploadedPath, () => {});
      return res.status(409).json({ error: 'Prescriptions can only be added to draft discharges' });
    }

    const ocrResult = await ocrService.extractFromPrescription(req.file.path);

    if (!ocrResult.success) {
      fs.unlink(uploadedPath, () => {});
      return res.status(400).json({ error: ocrResult.error });
    }

    const prescriptionId = uuidv4();
    const medicinesJson = JSON.stringify(ocrResult.parsedData.medicines);

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO prescriptions 
         (id, dischargeId, filename, originalUrl, rawText, medicines, doctor, clinicName, prescriptionDate, confidence, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          prescriptionId,
          dischargeId,
          req.file.originalname,
          `/uploads/prescriptions/${req.file.filename}`,
          ocrResult.rawText,
          medicinesJson,
          ocrResult.parsedData.doctor,
          ocrResult.parsedData.clinicName,
          ocrResult.parsedData.date,
          ocrResult.confidence,
          'Pending'
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            fs.unlink(uploadedPath, () => {});
            resolve(res.json({
              success: true,
              prescription: {
                id: prescriptionId,
                filename: req.file.originalname,
                rawText: ocrResult.rawText,
                parsedData: ocrResult.parsedData,
                confidence: ocrResult.confidence
              }
            }));
          }
        }
      );
    });
  } catch (error) {
    if (uploadedPath) fs.unlink(uploadedPath, () => {});
    res.status(500).json({ error: error.message });
  }
});

router.post('/verify', authMiddleware, (req, res) => {
  try {
    const { prescriptionId, verifiedData } = req.body;
    if (!prescriptionId || !verifiedData || !Array.isArray(verifiedData.medicines)) {
      return res.status(400).json({ error: 'Prescription ID and medicines are required' });
    }
    const medicinesJson = JSON.stringify(verifiedData.medicines);

    db.run(
      `UPDATE prescriptions 
       SET status = 'Verified', medicines = ?, verifiedById = ?
       WHERE id = ?`,
      [medicinesJson, req.user.id, prescriptionId],
      function (err) {
        if (err) {
          res.status(500).json({ error: err.message });
        } else if (!this.changes) {
          res.status(404).json({ error: 'Prescription not found' });
        } else {
          res.json({ success: true, message: 'Prescription verified' });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/history/:dischargeId', authMiddleware, (req, res) => {
  try {
    const { dischargeId } = req.params;

    db.all(
      'SELECT * FROM prescriptions WHERE dischargeId = ?',
      [dischargeId],
      (err, rows) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          const prescriptions = rows.map(row => ({
            ...row,
            medicines: JSON.parse(row.medicines || '[]')
          }));
          res.json({ success: true, prescriptions });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;