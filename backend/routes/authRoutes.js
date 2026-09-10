const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRoles } = authMiddleware;

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { staffId, password } = req.body;

    if (!staffId || !password) {
      return res.status(400).json({ error: 'Staff ID and password are required' });
    }

    const user = await User.findByStaffId(staffId);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'Active') {
      return res.status(403).json({ error: 'Staff account is inactive' });
    }

    if (!['Doctor', 'Nurse', 'Admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Staff role is not authorized' });
    }

    const isPasswordValid = await User.verifyPassword(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, staffId: user.staffId, name: user.name, department: user.department, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        staffId: user.staffId,
        name: user.name,
        department: user.department,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { staffId, email, password, name, department, role } = req.body;
    if (!staffId || !email || !password || !name || !department || !['Doctor', 'Nurse'].includes(role)) {
      return res.status(400).json({ error: 'Staff ID, email, password, name, department, and Doctor or Nurse role are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (await User.findByStaffId(staffId)) {
      return res.status(409).json({ error: 'Staff ID is already registered' });
    }

    const staff = await User.create(staffId, email, password, name.trim(), department.trim(), role, 'Active');
    res.status(201).json({ success: true, message: 'Signup successful. You can sign in immediately.', staff: { id: staff.id, staffId, status: 'Active' } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/staff-list', authMiddleware, requireRoles('Admin'), async (req, res) => {
  try {
    const staff = await User.getAll();
    res.json({ success: true, staff });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/staff/pending', authMiddleware, requireRoles('Admin'), async (req, res) => {
  try {
    const staff = await new Promise((resolve, reject) => {
      const db = require('../config/database');
      db.all(`SELECT id, staffId, email, name, department, role, status, createdAt FROM users WHERE status = 'Pending' ORDER BY createdAt ASC`, (error, rows) => error ? reject(error) : resolve(rows));
    });
    res.json({ success: true, staff });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/staff/:id/approve', authMiddleware, requireRoles('Admin'), async (req, res) => {
  try {
    const updated = await User.updateStatus(req.params.id, 'Active');
    if (!updated) return res.status(404).json({ error: 'Pending staff account not found' });
    res.json({ success: true, message: 'Staff account approved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/staff/:id/reject', authMiddleware, requireRoles('Admin'), async (req, res) => {
  try {
    const updated = await User.updateStatus(req.params.id, 'Rejected');
    if (!updated) return res.status(404).json({ error: 'Pending staff account not found' });
    res.json({ success: true, message: 'Staff account rejected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/staff', authMiddleware, requireRoles('Admin'), async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Admin users can create staff accounts' });
    }

    const { staffId, email, password, name, department, role } = req.body;
    if (!staffId || !email || !password || !name || !department || !['Doctor', 'Nurse', 'Admin'].includes(role)) {
      return res.status(400).json({ error: 'Staff ID, email, password, name, department, and valid role are required' });
    }

    const staff = await User.create(staffId, email, password, name, department, role);
    res.status(201).json({ success: true, staff });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;