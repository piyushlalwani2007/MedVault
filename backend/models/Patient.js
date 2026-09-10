const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Patient {
  static async create(mrn, name, age, disease, testDetails, gender, bloodGroup, phone, email, address, emergencyContact) {
    return new Promise((resolve, reject) => {
      const id = uuidv4();

      db.run(
        `INSERT INTO patients (id, mrn, name, age, disease, testDetails, gender, bloodGroup, phone, email, address, emergencyContact)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, mrn, name, age, disease, testDetails, gender, bloodGroup, phone, email, address, emergencyContact],
        function (err) {
          if (err) reject(err);
          else resolve({ id, mrn, name, age, disease, testDetails, gender, bloodGroup });
        }
      );
    });
  }

  static async findByMRN(mrn) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM patients WHERE mrn = ?', [mrn], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM patients WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async getAll() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM patients ORDER BY createdAt DESC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async update(id, updates) {
    const allowedFields = [
      'name', 'age', 'disease', 'testDetails', 'gender', 'bloodGroup',
      'phone', 'email', 'address', 'emergencyContact'
    ];
    const keys = Object.keys(updates).filter(key => allowedFields.includes(key));
    if (!keys.length) throw new Error('No valid patient fields to update');

    return new Promise((resolve, reject) => {
      const values = keys.map(key => updates[key]);
      values.push(id);
      const query = `UPDATE patients SET ${keys.map(key => `${key} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`;

      db.run(query, values, function (err) {
        if (err) reject(err);
        else if (!this.changes) resolve(null);
        else Patient.findById(id).then(resolve).catch(reject);
      });
    });
  }
}

module.exports = Patient;