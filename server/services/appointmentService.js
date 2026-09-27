const db = require('../db');
const eventBus = require('../events/eventBus');

const STANDARD_TIME_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '02:00 PM', '02:30 PM',
  '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
];

class AppointmentService {
  getStandardSlots() {
    return [...STANDARD_TIME_SLOTS];
  }

  getDoctorAvailability(doctorId, dateString) {
    const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);
    if (!doctor) {
      throw new Error(`Doctor with ID '${doctorId}' not found.`);
    }

    // Check if date is blocked
    const blocked = db.prepare('SELECT reason FROM doctor_blocked_dates WHERE doctor_id = ? AND date = ?').get(doctorId, dateString);
    if (blocked) {
      return {
        doctor_id: doctorId,
        date: dateString,
        is_blocked: true,
        block_reason: blocked.reason || 'Doctor unavailable',
        slots: STANDARD_TIME_SLOTS.map(time => ({ time, available: false, reason: 'Doctor off-duty / blocked' }))
      };
    }

    // Check working days
    const dateObj = new Date(dateString + 'T00:00:00');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDayName = dayNames[dateObj.getDay()];
    const workingDays = (doctor.working_days || 'Mon,Tue,Wed,Thu,Fri,Sat').split(',');

    if (!workingDays.includes(currentDayName)) {
      return {
        doctor_id: doctorId,
        date: dateString,
        is_blocked: true,
        block_reason: `Doctor does not consult on ${currentDayName}s`,
        slots: STANDARD_TIME_SLOTS.map(time => ({ time, available: false, reason: 'Non-working day' }))
      };
    }

    // Query active booked appointments for this doctor on this date
    const bookedAppointments = db.prepare(`
      SELECT appointment_time, id, status 
      FROM appointments 
      WHERE doctor_id = ? AND appointment_date = ? AND status != 'cancelled'
    `).all(doctorId, dateString);

    const bookedTimeMap = new Map();
    for (const appt of bookedAppointments) {
      bookedTimeMap.set(appt.appointment_time, appt);
    }

    const slots = STANDARD_TIME_SLOTS.map(time => {
      const isBooked = bookedTimeMap.has(time);
      return {
        time,
        available: !isBooked,
        reason: isBooked ? 'Slot already reserved' : 'Available'
      };
    });

    return {
      doctor_id: doctorId,
      date: dateString,
      is_blocked: false,
      block_reason: null,
      slots
    };
  }

  generateAppointmentId() {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    return `MAI-2026-${randomNum}`;
  }

  createAppointment(data) {
    const {
      patient_id = null,
      patient_name,
      patient_email,
      patient_phone,
      doctor_id,
      department_id,
      hospital_id = 'hosp-main',
      appointment_date,
      appointment_time,
      type = 'In-person',
      notes = '',
      booking_source = 'web'
    } = data;

    // Validation
    if (!patient_name || !patient_email || !patient_phone) {
      const err = new Error('Patient name, email, and phone number are required.');
      err.statusCode = 400;
      throw err;
    }

    if (!doctor_id || !department_id || !appointment_date || !appointment_time) {
      const err = new Error('Doctor, department, appointment date, and time slot are required.');
      err.statusCode = 400;
      throw err;
    }

    const doctor = db.prepare(`
      SELECT d.*, dept.name as department_name, h.name as hospital_name 
      FROM doctors d
      JOIN departments dept ON d.department_id = dept.id
      JOIN hospitals h ON d.hospital_id = h.id
      WHERE d.id = ?
    `).get(doctor_id);

    if (!doctor) {
      const err = new Error(`Doctor '${doctor_id}' does not exist.`);
      err.statusCode = 404;
      throw err;
    }

    // Atomic Transaction: Check and reserve slot safely
    db.exec('BEGIN IMMEDIATE');

    try {
      // Check if slot is already occupied
      const existing = db.prepare(`
        SELECT id, patient_name, status 
        FROM appointments 
        WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'
      `).get(doctor_id, appointment_date, appointment_time);

      if (existing) {
        db.exec('ROLLBACK');
        const availability = this.getDoctorAvailability(doctor_id, appointment_date);
        const openSlots = availability.slots.filter(s => s.available).map(s => s.time);
        
        const err = new Error(`The requested time slot (${appointment_time}) on ${appointment_date} with ${doctor.name} is already booked.`);
        err.statusCode = 409;
        err.conflictDetails = {
          doctor_name: doctor.name,
          date: appointment_date,
          occupied_slot: appointment_time,
          alternative_slots: openSlots
        };
        throw err;
      }

      // Generate unique appointment ID
      let appointmentId;
      let isUnique = false;
      while (!isUnique) {
        appointmentId = this.generateAppointmentId();
        const check = db.prepare('SELECT id FROM appointments WHERE id = ?').get(appointmentId);
        if (!check) isUnique = true;
      }

      const insertStmt = db.prepare(`
        INSERT INTO appointments (
          id, patient_id, patient_name, patient_email, patient_phone,
          doctor_id, department_id, hospital_id, appointment_date, appointment_time,
          status, type, consultation_fee, notes, booking_source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      insertStmt.run(
        appointmentId,
        patient_id,
        patient_name.trim(),
        patient_email.trim().toLowerCase(),
        patient_phone.trim(),
        doctor_id,
        department_id,
        hospital_id,
        appointment_date,
        appointment_time,
        type,
        doctor.consultation_fee,
        notes,
        booking_source
      );

      db.exec('COMMIT');

      const createdAppointment = this.getAppointmentById(appointmentId);

      // Emit application event for notifications / email
      eventBus.emit('appointment.created', createdAppointment);

      return createdAppointment;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {
        // Rollback may already have occurred
      }

      // Catch SQLite unique constraint violations if race condition occurred
      if (error.message && error.message.includes('UNIQUE constraint failed')) {
        const err = new Error(`Concurrent booking conflict: Time slot ${appointment_time} on ${appointment_date} was just secured by another patient.`);
        err.statusCode = 409;
        throw err;
      }

      throw error;
    }
  }

  getAppointmentById(id) {
    const appt = db.prepare(`
      SELECT 
        a.*,
        d.name as doctor_name,
        d.specialty as doctor_specialty,
        d.image_url as doctor_image,
        dept.name as department_name,
        dept.icon as department_icon,
        h.name as hospital_name,
        h.address as hospital_address,
        h.phone as hospital_phone
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN departments dept ON a.department_id = dept.id
      JOIN hospitals h ON a.hospital_id = h.id
      WHERE a.id = ?
    `).get(id);

    if (appt) {
      appt.notifications = db.prepare('SELECT id, status, channel, event_type, sent_at, error_message FROM notifications WHERE appointment_id = ? ORDER BY created_at DESC').all(id);
    }

    return appt;
  }

  rescheduleAppointment(id, newDate, newTime) {
    const appt = this.getAppointmentById(id);
    if (!appt) {
      const err = new Error(`Appointment '${id}' not found.`);
      err.statusCode = 404;
      throw err;
    }

    if (appt.status === 'cancelled') {
      const err = new Error('Cannot reschedule a cancelled appointment.');
      err.statusCode = 400;
      throw err;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      // Check if new slot is taken by another appointment
      const conflict = db.prepare(`
        SELECT id FROM appointments 
        WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND id != ? AND status != 'cancelled'
      `).get(appt.doctor_id, newDate, newTime, id);

      if (conflict) {
        db.exec('ROLLBACK');
        const err = new Error(`The requested slot (${newTime} on ${newDate}) is already occupied.`);
        err.statusCode = 409;
        throw err;
      }

      db.prepare(`
        UPDATE appointments 
        SET appointment_date = ?, appointment_time = ?, status = 'rescheduled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newDate, newTime, id);

      db.exec('COMMIT');

      const updated = this.getAppointmentById(id);
      eventBus.emit('appointment.rescheduled', updated);
      return updated;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  }

  cancelAppointment(id, reason = '') {
    const appt = this.getAppointmentById(id);
    if (!appt) {
      const err = new Error(`Appointment '${id}' not found.`);
      err.statusCode = 404;
      throw err;
    }

    if (appt.status === 'cancelled') {
      return appt;
    }

    db.prepare(`
      UPDATE appointments 
      SET status = 'cancelled', notes = CASE WHEN ? != '' THEN notes || ' [Cancelled: ' || ? || ']' ELSE notes END, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reason, reason, id);

    const cancelled = this.getAppointmentById(id);
    eventBus.emit('appointment.cancelled', cancelled);
    return cancelled;
  }

  updateAppointmentStatus(id, newStatus) {
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'checked_in', 'in_consultation'];
    if (!validStatuses.includes(newStatus)) {
      const err = new Error(`Invalid status '${newStatus}'.`);
      err.statusCode = 400;
      throw err;
    }

    db.prepare('UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, id);
    return this.getAppointmentById(id);
  }

  getAllAppointments(filters = {}) {
    let sql = `
      SELECT 
        a.*,
        d.name as doctor_name,
        d.specialty as doctor_specialty,
        d.image_url as doctor_image,
        dept.name as department_name,
        dept.icon as department_icon,
        h.name as hospital_name
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN departments dept ON a.department_id = dept.id
      JOIN hospitals h ON a.hospital_id = h.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.patient_email) {
      sql += ' AND LOWER(a.patient_email) = ?';
      params.push(filters.patient_email.toLowerCase());
    }

    if (filters.doctor_id) {
      sql += ' AND a.doctor_id = ?';
      params.push(filters.doctor_id);
    }

    if (filters.department_id) {
      sql += ' AND a.department_id = ?';
      params.push(filters.department_id);
    }

    if (filters.status) {
      sql += ' AND a.status = ?';
      params.push(filters.status);
    }

    if (filters.date) {
      sql += ' AND a.appointment_date = ?';
      params.push(filters.date);
    }

    if (filters.query) {
      sql += ' AND (LOWER(a.patient_name) LIKE ? OR LOWER(a.id) LIKE ? OR LOWER(d.name) LIKE ?)';
      const q = `%${filters.query.toLowerCase()}%`;
      params.push(q, q, q);
    }

    sql += ' ORDER BY a.appointment_date DESC, a.appointment_time DESC';

    const appointments = db.prepare(sql).all(...params);

    // Attach latest notification status for each appointment
    for (const a of appointments) {
      const latestNotif = db.prepare('SELECT status, channel, error_message FROM notifications WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1').get(a.id);
      a.notification_status = latestNotif ? latestNotif.status : 'none';
    }

    return appointments;
  }
}

module.exports = new AppointmentService();
