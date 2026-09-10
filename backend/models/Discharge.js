const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Discharge {
  static async create(patientId, dischargeData, createdById) {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const dischargeId = `DC-${Date.now()}`;

      db.run(
        `INSERT INTO discharges 
         (id, dischargeId, patientId, admissionDate, dischargeDate, diagnosis, treatment, dischargeInstructions, createdById)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          dischargeId,
          patientId,
          dischargeData.admissionDate,
          dischargeData.dischargeDate,
          dischargeData.diagnosis,
          dischargeData.treatment,
          dischargeData.dischargeInstructions,
          createdById
        ],
        function (err) {
          if (err) reject(err);
          else resolve({ id, dischargeId });
        }
      );
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM discharges WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async update(id, updates) {
    return new Promise((resolve, reject) => {
      const allowedFields = [
        'admissionDate', 'dischargeDate', 'diagnosis', 'treatment',
        'dischargeInstructions', 'status', 'approvedById', 'qrCode'
      ];
      const keys = Object.keys(updates).filter(key => allowedFields.includes(key));
      if (!keys.length) return reject(new Error('No valid discharge fields to update'));
      const filteredValues = keys.map(key => updates[key]);
      filteredValues.push(id);

      const query = `UPDATE discharges SET ${keys.map(k => `${k} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`;

      db.run(query, filteredValues, function (err) {
        if (err) reject(err);
        else resolve({ success: true, changes: this.changes });
      });
    });
  }

  static async getAll() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT d.*, p.name as patientName, p.mrn FROM discharges d
         LEFT JOIN patients p ON d.patientId = p.id
         ORDER BY d.createdAt DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }
}

module.exports = Discharge;