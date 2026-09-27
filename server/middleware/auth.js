const db = require('../db');

function authenticate(req, res, next) {
  // Support demo authentication via headers
  const roleHeader = req.headers['x-user-role'] || 'patient';
  const userIdHeader = req.headers['x-user-id'];
  const userEmailHeader = req.headers['x-user-email'];
  const userNameHeader = req.headers['x-user-name'];

  let user = null;

  if (userIdHeader) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdHeader);
  }

  if (!user && userEmailHeader) {
    user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(userEmailHeader);
  }

  if (!user) {
    // Fall back to default user based on role
    user = db.prepare('SELECT * FROM users WHERE role = ? LIMIT 1').get(roleHeader);
  }

  req.user = user ? { ...user } : {
    id: userIdHeader || 'guest',
    name: userNameHeader || 'Guest User',
    email: userEmailHeader || 'guest@mediassist.ai',
    role: roleHeader
  };

  // If client provided specific email or name in session, preserve it
  if (userEmailHeader) {
    req.user.email = userEmailHeader.trim().toLowerCase();
  }
  if (userNameHeader) {
    req.user.name = userNameHeader.trim();
  }
  if (roleHeader) {
    req.user.role = roleHeader;
  }

  next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden: You do not have permission to perform this operation.',
        userRole: req.user ? req.user.role : 'none',
        requiredRoles: allowedRoles
      });
    }
    next();
  };
}

module.exports = {
  authenticate,
  requireRole
};
