const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_ROOT = path.resolve(
  process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || APP_ROOT
);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(STORAGE_ROOT, 'data'));
const DB_PATH = path.join(DATA_DIR, 'arcsite.db');
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(STORAGE_ROOT, 'uploads'));

module.exports = {
  APP_ROOT,
  STORAGE_ROOT,
  DATA_DIR,
  DB_PATH,
  UPLOADS_DIR,
};
