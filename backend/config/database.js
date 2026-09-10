const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const configuredDatabasePath = process.env.DATABASE_PATH || 'database.sqlite';
const localDatabasePath = path.isAbsolute(configuredDatabasePath)
  ? configuredDatabasePath
  : path.resolve(__dirname, '../../', configuredDatabasePath);
const dbPath = process.env.VERCEL === '1'
  ? path.join('/tmp', 'hospital-discharge.sqlite')
  : localDatabasePath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

if (process.env.VERCEL === '1' && !fs.existsSync(dbPath) && fs.existsSync(localDatabasePath)) {
  fs.copyFileSync(localDatabasePath, dbPath);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log(`✅ SQLite Database connected: ${dbPath}`);
    db.run('PRAGMA foreign_keys = ON');
    initializeTables();
  }
});

function initializeTables() {
  db.serialize(() => {
    // Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        staffId TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        department TEXT NOT NULL,
        role TEXT DEFAULT 'Doctor',
        phone TEXT,
        status TEXT DEFAULT 'Active',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Patients Table
    db.run(`
      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY,
        mrn TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        age INTEGER,
        disease TEXT NOT NULL,
        testDetails TEXT NOT NULL,
        gender TEXT,
        bloodGroup TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        emergencyContact TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME
      )
    `);

    // Discharges Table
    db.run(`
      CREATE TABLE IF NOT EXISTS discharges (
        id TEXT PRIMARY KEY,
        dischargeId TEXT UNIQUE NOT NULL,
        patientId TEXT NOT NULL,
        admissionDate DATE,
        dischargeDate DATE,
        diagnosis TEXT,
        treatment TEXT,
        dischargeInstructions TEXT,
        status TEXT DEFAULT 'Draft',
        createdById TEXT,
        approvedById TEXT,
        qrCode TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME,
        FOREIGN KEY (patientId) REFERENCES patients(id),
        FOREIGN KEY (createdById) REFERENCES users(id),
        FOREIGN KEY (approvedById) REFERENCES users(id)
      )
    `);

    // Prescriptions Table
    db.run(`
      CREATE TABLE IF NOT EXISTS prescriptions (
        id TEXT PRIMARY KEY,
        dischargeId TEXT NOT NULL,
        filename TEXT NOT NULL,
        originalUrl TEXT NOT NULL,
        rawText TEXT,
        medicines TEXT,
        doctor TEXT,
        clinicName TEXT,
        prescriptionDate DATE,
        status TEXT DEFAULT 'Pending',
        verifiedById TEXT,
        confidence INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dischargeId) REFERENCES discharges(id),
        FOREIGN KEY (verifiedById) REFERENCES users(id)
      )
    `);

    // Medications Table
    db.run(`
      CREATE TABLE IF NOT EXISTS medications (
        id TEXT PRIMARY KEY,
        dischargeId TEXT NOT NULL,
        name TEXT NOT NULL,
        dosage TEXT,
        frequency TEXT,
        duration TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dischargeId) REFERENCES discharges(id)
      )
    `);

    // Notifications Table
    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        patientId TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        message TEXT,
        testName TEXT,
        testDate DATE,
        testTime TEXT,
        location TEXT,
        instructions TEXT,
        channel TEXT DEFAULT 'In-App',
        scheduledFor DATETIME,
        status TEXT DEFAULT 'Pending',
        sentAt DATETIME,
        retries INTEGER DEFAULT 0,
        createdById TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patientId) REFERENCES patients(id),
        FOREIGN KEY (createdById) REFERENCES users(id)
      )
    `);

    console.log('✅ All tables initialized');
    ensureColumn('patients', 'disease', 'TEXT');
    ensureColumn('patients', 'testDetails', 'TEXT');
  });
}

function ensureColumn(table, column, definition) {
  db.all(`PRAGMA table_info(${table})`, (err, columns) => {
    if (err) {
      console.error(`❌ Could not inspect ${table}:`, err);
      return;
    }

    if (!columns.some(existingColumn => existingColumn.name === column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (alterError) => {
        if (alterError) console.error(`❌ Could not add ${column} to ${table}:`, alterError);
      });
    }
  });
}

module.exports = db;