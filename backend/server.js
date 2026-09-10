const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8000,http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Security Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Body Parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static Files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database initialization
require('./config/database');

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/discharge', require('./routes/dischargeRoutes'));
app.use('/api/ocr', require('./routes/ocrRoutes'));
app.use('/api/patients', require('./routes/patientRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));

// Error Handler
app.use(require('./middleware/errorHandler'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = app;