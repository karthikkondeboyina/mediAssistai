const express = require('express');
const router = express.Router();
const departmentService = require('../services/departmentService');
const { requireRole } = require('../middleware/auth');

// GET /api/departments
router.get('/', (req, res, next) => {
  try {
    const depts = departmentService.getAllDepartments();
    res.json(depts);
  } catch (err) {
    next(err);
  }
});

// GET /api/departments/:id
router.get('/:id', (req, res, next) => {
  try {
    const dept = departmentService.getDepartmentById(req.params.id);
    if (!dept) {
      return res.status(404).json({ error: `Department '${req.params.id}' not found.` });
    }
    res.json(dept);
  } catch (err) {
    next(err);
  }
});

// POST /api/departments (Admin only)
router.post('/', requireRole(['administrator']), (req, res, next) => {
  try {
    const created = departmentService.createDepartment(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/departments/:id (Admin only)
router.patch('/:id', requireRole(['administrator']), (req, res, next) => {
  try {
    const updated = departmentService.updateDepartment(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
