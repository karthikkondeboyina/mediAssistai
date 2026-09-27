const db = require('../db');

class DoctorService {
  getAllDoctors(filters = {}) {
    let sql = `
      SELECT d.*, dept.name as department_name, dept.icon as department_icon
      FROM doctors d
      JOIN departments dept ON d.department_id = dept.id
      WHERE d.active = 1
    `;
    const params = [];

    if (filters.department_id) {
      sql += ' AND d.department_id = ?';
      params.push(filters.department_id);
    }

    if (filters.min_exp) {
      sql += ' AND d.experience_years >= ?';
      params.push(parseInt(filters.min_exp, 10));
    }

    if (filters.max_fee) {
      sql += ' AND d.consultation_fee <= ?';
      params.push(parseFloat(filters.max_fee));
    }

    if (filters.query) {
      sql += ' AND (LOWER(d.name) LIKE ? OR LOWER(d.specialty) LIKE ? OR LOWER(dept.name) LIKE ?)';
      const q = `%${filters.query.toLowerCase()}%`;
      params.push(q, q, q);
    }

    sql += ' ORDER BY d.rating DESC, d.experience_years DESC';

    return db.prepare(sql).all(...params);
  }

  getDoctorById(id) {
    const doc = db.prepare(`
      SELECT d.*, dept.name as department_name, dept.icon as department_icon, h.name as hospital_name, h.address as hospital_address
      FROM doctors d
      JOIN departments dept ON d.department_id = dept.id
      JOIN hospitals h ON d.hospital_id = h.id
      WHERE d.id = ?
    `).get(id);

    if (!doc) return null;

    doc.blocked_dates = db.prepare('SELECT date, reason FROM doctor_blocked_dates WHERE doctor_id = ?').all(id);
    return doc;
  }

  updateDoctorProfile(id, updates) {
    const fields = [];
    const params = [];

    if (updates.name) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.specialty) { fields.push('specialty = ?'); params.push(updates.specialty); }
    if (updates.experience_years !== undefined) { fields.push('experience_years = ?'); params.push(parseInt(updates.experience_years, 10)); }
    if (updates.consultation_fee !== undefined) { fields.push('consultation_fee = ?'); params.push(parseFloat(updates.consultation_fee)); }
    if (updates.biography) { fields.push('biography = ?'); params.push(updates.biography); }
    if (updates.languages) { fields.push('languages = ?'); params.push(updates.languages); }

    if (fields.length === 0) return this.getDoctorById(id);

    params.push(id);
    db.prepare(`UPDATE doctors SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.getDoctorById(id);
  }

  updateWorkingHours(id, workingDays, start, end) {
    db.prepare(`
      UPDATE doctors 
      SET working_days = ?, working_hours_start = ?, working_hours_end = ?
      WHERE id = ?
    `).run(workingDays, start, end, id);
    return this.getDoctorById(id);
  }

  blockDate(doctorId, date, reason = '') {
    db.prepare('INSERT INTO doctor_blocked_dates (doctor_id, date, reason) VALUES (?, ?, ?)').run(doctorId, date, reason);
    return db.prepare('SELECT date, reason FROM doctor_blocked_dates WHERE doctor_id = ?').all(doctorId);
  }

  unblockDate(doctorId, date) {
    db.prepare('DELETE FROM doctor_blocked_dates WHERE doctor_id = ? AND date = ?').run(doctorId, date);
    return db.prepare('SELECT date, reason FROM doctor_blocked_dates WHERE doctor_id = ?').all(doctorId);
  }
}

module.exports = new DoctorService();
