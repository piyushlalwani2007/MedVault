const db = require('../config/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

class User {
  static async create(staffId, email, password, name, department, role = 'Doctor', status = 'Active') {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const hashedPassword = bcrypt.hashSync(password, 10);

      db.run(
        `INSERT INTO users (id, staffId, email, password, name, department, role, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, staffId, email, hashedPassword, name, department, role, status],
        function (err) {
          if (err) reject(err);
          else resolve({ id, staffId, email, name, department, role });
        }
      );
    });
  }

  static async findByStaffId(staffId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE staffId = ?', [staffId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  static async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  static async getAll() {
    return new Promise((resolve, reject) => {
      db.all('SELECT id, staffId, name, department, role, status, createdAt FROM users', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async updateStatus(id, status) {
    return new Promise((resolve, reject) => {
      db.run('UPDATE users SET status = ? WHERE id = ?', [status, id], function (err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  }
}

module.exports = User;