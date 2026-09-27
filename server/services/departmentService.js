const db = require('../db');

class DepartmentService {
  getAllDepartments() {
    return db.prepare(`
      SELECT dept.*, COUNT(d.id) as doctor_count
      FROM departments dept
      LEFT JOIN doctors d ON dept.id = d.department_id AND d.active = 1
      WHERE dept.active = 1
      GROUP BY dept.id
      ORDER BY dept.name ASC
    `).all();
  }

  getDepartmentById(id) {
    return db.prepare(`
      SELECT dept.*, COUNT(d.id) as doctor_count
      FROM departments dept
      LEFT JOIN doctors d ON dept.id = d.department_id AND d.active = 1
      WHERE dept.id = ?
      GROUP BY dept.id
    `).get(id);
  }

  createDepartment(data) {
    const id = data.id || data.name.toLowerCase().replace(/\s+/g, '-');
    db.prepare(`
      INSERT INTO departments (id, hospital_id, name, icon, description, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, data.hospital_id || 'hosp-main', data.name, data.icon || 'stethoscope', data.description || '');
    return this.getDepartmentById(id);
  }

  updateDepartment(id, updates) {
    const fields = [];
    const params = [];

    if (updates.name) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.icon) { fields.push('icon = ?'); params.push(updates.icon); }
    if (updates.description) { fields.push('description = ?'); params.push(updates.description); }

    if (fields.length > 0) {
      params.push(id);
      db.prepare(`UPDATE departments SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.getDepartmentById(id);
  }
}

module.exports = new DepartmentService();
