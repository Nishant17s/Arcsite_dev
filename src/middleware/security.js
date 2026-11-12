const rateLimit = require('express-rate-limit');

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Validate that a string looks like a UUID or safe ID
function isValidId(id) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

// Allowed file extensions for upload
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.ifc', '.dxf', '.dwg', '.bak',
  '.skp', '.skb', '.rvt', '.rfa',
  '.glb', '.gltf', '.obj', '.fbx', '.3ds', '.stl', '.dae', '.3dm',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.tiff', '.tif', '.bmp',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.txt', '.csv', '.json', '.xml', '.html', '.md'
]);

const OS_JUNK_NAMES = new Set(['thumbs.db', '.ds_store', 'desktop.ini', '__macosx']);

function isIgnoredOsFile(filename) {
  const base = require('path').basename(filename || '').toLowerCase();
  return OS_JUNK_NAMES.has(base) || base.startsWith('~$');
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

function isAllowedExtension(filename) {
  const ext = require('path').extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

// Sanitize string inputs
function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

// Middleware to validate project ID param
function validateProjectId(req, res, next) {
  const id = req.params.id;
  if (id && !isValidId(id)) {
    return res.status(400).json({ success: false, error: 'Invalid project ID format' });
  }
  next();
}

// General security middleware (applied globally)
function securityMiddleware(req, res, next) {
  // Basic request size sanity — already handled by express.json limit
  next();
}

module.exports = {
  authLimiter,
  apiLimiter,
  isValidId,
  isAllowedExtension,
  isIgnoredOsFile,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  sanitizeString,
  validateProjectId,
  securityMiddleware
};
