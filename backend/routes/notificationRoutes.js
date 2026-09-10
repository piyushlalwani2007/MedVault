const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/create-test-reminder', authMiddleware, async (req, res) => {
  try {
    const { patientId, testName, testDate, testTime, location, instructions } = req.body;

    if (!patientId || !testName || !testDate || !testTime) {
      return res.status(400).json({ error: 'Patient, test name, date, and time are required' });
    }

    const notificationId = uuidv4();

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO notifications 
         (id, patientId, type, title, testName, testDate, testTime, location, instructions, channel, createdById)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          notificationId,
          patientId,
          'Test Reminder',
          `Reminder: ${testName}`,
          testName,
          testDate,
          testTime,
          location,
          instructions,
          'In-App',
          req.user.id
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(res.json({
              success: true,
              notification: {
                id: notificationId,
                message: `Test reminder created for ${testName}`
              }
            }));
          }
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:notificationId/read', authMiddleware, (req, res) => {
  db.run(
    `UPDATE notifications SET status = 'Read', sentAt = CURRENT_TIMESTAMP
     WHERE id = ? AND channel = 'In-App'`,
    [req.params.notificationId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: 'Notification not found' });
      res.json({ success: true, message: 'Notification marked as read' });
    }
  );
});

router.get('/pending', authMiddleware, (req, res) => {
  try {
    db.all(
      `SELECT n.*, p.name as patientName FROM notifications n
       LEFT JOIN patients p ON n.patientId = p.id
       WHERE n.status = 'Pending'
       ORDER BY n.scheduledFor ASC`,
      (err, rows) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({ success: true, notifications: rows });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;