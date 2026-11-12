const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getUserById } = require('../db/database');
const { DATA_DIR } = require('../config/paths');

const SECRET_FILE = path.join(DATA_DIR, '.jwt-secret');

function loadOrCreateJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (existing) return existing;
    }
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    const generated = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    return generated;
  } catch (err) {
    // Fallback to in-memory secret if filesystem write fails
    return crypto.randomBytes(64).toString('hex');
  }
}

const JWT_SECRET = loadOrCreateJwtSecret();
const TOKEN_EXPIRY = '7d';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function isHttpsRequest(req) {
  return Boolean(req && (req.secure || req.headers?.['x-forwarded-proto'] === 'https'));
}

function setTokenCookie(res, token, req) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: isHttpsRequest(req) || (process.env.NODE_ENV === 'production' && !req),
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function clearTokenCookie(res, req) {
  res.clearCookie('token', {
    httpOnly: true,
    secure: isHttpsRequest(req) || (process.env.NODE_ENV === 'production' && !req),
    sameSite: 'lax'
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = {
  JWT_SECRET,
  generateToken,
  setTokenCookie,
  clearTokenCookie,
  requireAuth
};
