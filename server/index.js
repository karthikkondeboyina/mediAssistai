require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

// Ensure database and schema are initialized
require('./db');

// Ensure notification listener is active
require('./services/notificationService');

const { authenticate } = require('./middleware/auth');

const departmentsRouter = require('./routes/departments');
const doctorsRouter = require('./routes/doctors');
const appointmentsRouter = require('./routes/appointments');
const aiRouter = require('./routes/ai');
const frontdeskRouter = require('./routes/frontdesk');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Core Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files from /public
app.use(express.static(path.join(__dirname, '../public')));

// Authentication context for all API endpoints
app.use('/api', authenticate);

// Mount API routes
app.use('/api/departments', departmentsRouter);
app.use('/api/doctors', doctorsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/frontdesk', frontdeskRouter);
app.use('/api/admin', adminRouter);

// Current user profile endpoint
app.get('/api/auth/me', (req, res) => {
  res.json({
    user: req.user
  });
});

// Fallback to index.html for single-page app routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Centralized error handling
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.error(`[Error] ${req.method} ${req.url} [${statusCode}]:`, err.message);

  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    statusCode,
    conflict: statusCode === 409,
    details: err.conflictDetails || null
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` MediAssist AI Server running at http://localhost:${PORT}`);
    console.log(` Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(` SQLite Database: active with WAL mode & constraints`);
    console.log(` Email Notifications: active (${process.env.TEST_EMAIL_RECIPIENT || 'karthikkondeboyina@gmail.com'})`);
    console.log(`====================================================`);
  });
}

module.exports = app;
