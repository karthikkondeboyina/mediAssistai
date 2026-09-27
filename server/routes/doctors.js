const express = require('express');
const router = express.Router();
const doctorService = require('../services/doctorService');
const appointmentService = require('../services/appointmentService');
const { requireRole } = require('../middleware/auth');

// GET /api/doctors
router.get('/', (req, res, next) => {
  try {
    const { department_id, min_exp, max_fee, query } = req.query;
    const doctors = doctorService.getAllDoctors({
      department_id,
      min_exp,
      max_fee,
      query
    });
    res.json(doctors);
  } catch (err) {
    next(err);
  }
});

// GET /api/doctors/:id
router.get('/:id', (req, res, next) => {
  try {
    const doctor = doctorService.getDoctorById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ error: `Doctor '${req.params.id}' not found.` });
    }
    res.json(doctor);
  } catch (err) {
    next(err);
  }
});

// GET /api/doctors/:id/availability?date=YYYY-MM-DD
router.get('/:id/availability', (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const availability = appointmentService.getDoctorAvailability(req.params.id, date);
    res.json(availability);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/doctors/:id/profile (Doctor or Admin)
router.patch('/:id/profile', requireRole(['doctor', 'administrator']), (req, res, next) => {
  try {
    const updated = doctorService.updateDoctorProfile(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/doctors/:id/working-hours (Doctor or Admin)
router.patch('/:id/working-hours', requireRole(['doctor', 'administrator']), (req, res, next) => {
  try {
    const { working_days, start, end } = req.body;
    const updated = doctorService.updateWorkingHours(req.params.id, working_days, start, end);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/doctors/:id/blocked-dates (Doctor or Admin)
router.post('/:id/blocked-dates', requireRole(['doctor', 'administrator']), (req, res, next) => {
  try {
    const { date, reason } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'Date is required to block a schedule.' });
    }
    const blockedList = doctorService.blockDate(req.params.id, date, reason);
    res.json(blockedList);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/doctors/:id/blocked-dates/:date (Doctor or Admin)
router.delete('/:id/blocked-dates/:date', requireRole(['doctor', 'administrator']), (req, res, next) => {
  try {
    const blockedList = doctorService.unblockDate(req.params.id, req.params.date);
    res.json(blockedList);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
