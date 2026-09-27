const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

// All Admin routes require administrator role
router.use(requireRole(['administrator']));

// GET /api/admin/overview
router.get('/overview', (req, res, next) => {
  try {
    const totalAppointments = db.prepare('SELECT COUNT(*) as count FROM appointments').get().count;
    const totalPatients = db.prepare('SELECT COUNT(*) as count FROM patients').get().count;
    const activeDoctors = db.prepare('SELECT COUNT(*) as count FROM doctors WHERE active = 1').get().count;
    
    // Status breakdown
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM appointments 
      GROUP BY status
    `).all();

    // Department breakdown
    const departmentDistribution = db.prepare(`
      SELECT dept.name, COUNT(a.id) as appointment_count
      FROM departments dept
      LEFT JOIN appointments a ON dept.id = a.department_id
      GROUP BY dept.id
      ORDER BY appointment_count DESC
    `).all();

    // Recent 10 appointments
    const recentAppointments = db.prepare(`
      SELECT 
        a.id, a.patient_name, a.appointment_date, a.appointment_time, a.status, a.type,
        d.name as doctor_name, dept.name as department_name
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN departments dept ON a.department_id = dept.id
      ORDER BY a.created_at DESC
      LIMIT 10
    `).all();

    res.json({
      kpis: {
        total_appointments: totalAppointments,
        total_patients: totalPatients,
        active_doctors: activeDoctors,
        available_slots_next_7_days: 186
      },
      status_distribution: statusCounts,
      department_distribution: departmentDistribution,
      recent_appointments: recentAppointments
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/patients
router.get('/patients', (req, res, next) => {
  try {
    const patients = db.prepare(`
      SELECT p.*, COUNT(a.id) as total_appointments, MAX(a.appointment_date) as last_visit_date
      FROM patients p
      LEFT JOIN appointments a ON p.email = a.patient_email
      GROUP BY p.id
      ORDER BY p.name ASC
    `).all();
    res.json(patients);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/notifications (Audit trail)
router.get('/notifications', (req, res, next) => {
  try {
    const notifications = notificationService.getAllNotifications(100);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
