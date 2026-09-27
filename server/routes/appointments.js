const express = require('express');
const router = express.Router();
const appointmentService = require('../services/appointmentService');
const { requireRole } = require('../middleware/auth');

// GET /api/appointments
router.get('/', (req, res, next) => {
  try {
    const { patient_email, doctor_id, department_id, status, date, query } = req.query;
    const user = req.user;

    const filters = { department_id, status, date, query };

    // Apply role-based visibility restrictions
    if (user.role === 'patient') {
      filters.patient_email = user.email;
    } else if (user.role === 'doctor') {
      filters.doctor_id = user.doctor_id || doctor_id;
    } else {
      // Admin and FrontDesk can view all, or apply specific query filters
      if (patient_email) filters.patient_email = patient_email;
      if (doctor_id) filters.doctor_id = doctor_id;
    }

    const appointments = appointmentService.getAllAppointments(filters);
    res.json(appointments);
  } catch (err) {
    next(err);
  }
});

// GET /api/appointments/:id
router.get('/:id', (req, res, next) => {
  try {
    const appt = appointmentService.getAppointmentById(req.params.id);
    if (!appt) {
      return res.status(404).json({ error: `Appointment '${req.params.id}' not found.` });
    }

    // Role safety: patients can only view their own appointments
    if (req.user.role === 'patient' && appt.patient_email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'Forbidden: You cannot access other patients\' appointment records.' });
    }

    res.json(appt);
  } catch (err) {
    next(err);
  }
});

// POST /api/appointments (Atomic booking with double-booking prevention)
router.post('/', (req, res, next) => {
  try {
    const apptData = {
      ...req.body,
      booking_source: req.user.role === 'frontdesk' ? 'frontdesk' : (req.body.booking_source || 'web')
    };

    const newAppointment = appointmentService.createAppointment(apptData);
    res.status(201).json({
      message: 'Appointment booked successfully.',
      appointment: newAppointment
    });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({
        error: err.message,
        conflict: true,
        details: err.conflictDetails || null
      });
    }
    next(err);
  }
});

// PATCH /api/appointments/:id/reschedule
router.patch('/:id/reschedule', (req, res, next) => {
  try {
    const { new_date, new_time } = req.body;
    if (!new_date || !new_time) {
      return res.status(400).json({ error: 'New appointment date and time slot are required for rescheduling.' });
    }

    const rescheduled = appointmentService.rescheduleAppointment(req.params.id, new_date, new_time);
    res.json({
      message: 'Appointment rescheduled successfully.',
      appointment: rescheduled
    });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({ error: err.message, conflict: true });
    }
    next(err);
  }
});

// POST /api/appointments/:id/cancel
router.post('/:id/cancel', (req, res, next) => {
  try {
    const { reason = '' } = req.body;
    const cancelled = appointmentService.cancelAppointment(req.params.id, reason);
    res.json({
      message: 'Appointment cancelled successfully.',
      appointment: cancelled
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/appointments/:id/status (FrontDesk, Doctor, or Admin only)
router.patch('/:id/status', requireRole(['frontdesk', 'doctor', 'administrator']), (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }
    const updated = appointmentService.updateAppointmentStatus(req.params.id, status);
    res.json({
      message: `Appointment status updated to ${status}.`,
      appointment: updated
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
