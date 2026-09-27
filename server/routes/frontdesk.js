const express = require('express');
const router = express.Router();
const appointmentService = require('../services/appointmentService');
const { requireRole } = require('../middleware/auth');
const db = require('../db');

// All FrontDesk routes require frontdesk or administrator role
router.use(requireRole(['frontdesk', 'administrator']));

// GET /api/frontdesk/queue?date=YYYY-MM-DD
router.get('/queue', (req, res, next) => {
  try {
    const today = req.query.date || new Date().toISOString().split('T')[0];
    const appointments = appointmentService.getAllAppointments({ date: today });

    const queue = {
      date: today,
      total_today: appointments.length,
      waiting: appointments.filter(a => a.status === 'confirmed'),
      checked_in: appointments.filter(a => a.status === 'checked_in'),
      in_consultation: appointments.filter(a => a.status === 'in_consultation'),
      completed: appointments.filter(a => a.status === 'completed'),
      cancelled: appointments.filter(a => a.status === 'cancelled')
    };

    res.json(queue);
  } catch (err) {
    next(err);
  }
});

// POST /api/frontdesk/checkin/:id
router.post('/checkin/:id', (req, res, next) => {
  try {
    const updated = appointmentService.updateAppointmentStatus(req.params.id, 'checked_in');
    res.json({
      message: `Patient ${updated.patient_name} checked in successfully.`,
      appointment: updated
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/frontdesk/walkin
router.post('/walkin', (req, res, next) => {
  try {
    const newAppointment = appointmentService.createAppointment({
      ...req.body,
      booking_source: 'frontdesk',
      type: 'In-person'
    });

    res.status(201).json({
      message: 'Walk-in appointment registered successfully.',
      appointment: newAppointment
    });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message, conflict: true, details: err.conflictDetails });
    }
    next(err);
  }
});

module.exports = router;
