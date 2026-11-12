const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  validateProjectId,
  sanitizeString,
  isValidId,
  isAllowedExtension,
  isIgnoredOsFile,
  MAX_FILE_SIZE
} = require('../middleware/security');
const { requireProjectAccess } = require('./projects');
const {
  getFilesByProject,
  getFile,
  createFile,
  updateFile,
  deleteFile: deleteFileRecord,
  getAsset,
  logActivity
} = require('../db/database');
const {
  getFileType,
  getMimeType,
  getFileCategory,
  extractFileMetadata,
  extractFileThumbnail
} = require('../services/fileProcessor');

const { STORAGE_ROOT, UPLOADS_DIR } = require('../config/paths');

const router = express.Router();

function cleanupUploadedFiles(files) {
  if (!Array.isArray(files)) return;
  for (const f of files) {
    if (f && f.path && fs.existsSync(f.path)) {
      try { fs.unlinkSync(f.path); } catch {}
    }
  }
}

function serializeFile(projectId, f) {
  return {
    ...f,
    download_url: `/api/projects/${projectId}/files/${f.id}/download`,
    thumbnail_url: f.thumbnail_path ? `/api/projects/${projectId}/files/${f.id}/thumbnail` : null
  };
}

// Multer config for file uploads
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const storedName = `${uuidv4()}${ext}`;
    cb(null, storedName);
  }
});

const fileUpload = multer({
  storage: fileStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (isIgnoredOsFile(file.originalname)) {
      return cb(null, false); // silently skip Thumbs.db / .DS_Store / ~$ temp files
    }
    if (isAllowedExtension(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${path.extname(file.originalname)}`));
    }
  }
});

// GET /api/projects/:id/files — list project files (optional filters: ?asset_id=&category=)
router.get('/:id/files', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const filters = {};
    if (req.query.asset_id) filters.asset_id = req.query.asset_id;
    if (req.query.category) filters.category = req.query.category;

    const files = getFilesByProject(req.params.id, filters).map(f => serializeFile(req.params.id, f));
    res.json({ success: true, files });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/files/upload — upload up to 10 files
router.post('/:id/files/upload', validateProjectId, requireProjectAccess, fileUpload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid files uploaded' });
    }

    let assetId = req.body.asset_id && req.body.asset_id !== 'null' ? sanitizeString(req.body.asset_id, 128) : null;
    if (assetId) {
      if (!isValidId(assetId)) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ success: false, error: 'Invalid asset_id' });
      }
      const asset = getAsset(assetId);
      if (!asset || asset.project_id !== req.params.id) {
        cleanupUploadedFiles(req.files);
        return res.status(404).json({ success: false, error: 'Target asset not found in project' });
      }
    }

    const rawCat = req.body.category ? sanitizeString(req.body.category, 50) : null;
    const categoryOverride = rawCat && rawCat.toLowerCase() !== 'auto' ? rawCat : null;
    const labelOverride = req.body.label ? sanitizeString(req.body.label, 200) : null;

    let relativePaths = [];
    if (req.body.relative_paths) {
      try {
        const parsed = JSON.parse(req.body.relative_paths);
        if (Array.isArray(parsed)) relativePaths = parsed;
      } catch {
        relativePaths = [];
      }
    }

    const savedFiles = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const fileId = uuidv4();
      const relPath = typeof relativePaths[i] === 'string' ? sanitizeString(relativePaths[i], 300) : '';
      const fileType = getFileType(file.originalname);
      const mimeType = getMimeType(file.originalname, file.mimetype);
      const category = categoryOverride || getFileCategory(file.originalname, relPath);
      const label = (req.files.length === 1 && labelOverride)
        ? labelOverride
        : path.basename(file.originalname, path.extname(file.originalname));
      const metadata = await extractFileMetadata(file.path, file.originalname, relPath);
      const thumbPath = await extractFileThumbnail(file.path, file.originalname, req.params.id, fileId);

      const fileRecord = createFile({
        id: fileId,
        project_id: req.params.id,
        asset_id: assetId,
        category,
        label,
        original_name: file.originalname,
        stored_name: file.filename,
        mime_type: mimeType,
        file_type: fileType,
        file_size: file.size,
        thumbnail_path: thumbPath,
        metadata,
        uploaded_by: req.user.id
      });

      savedFiles.push(serializeFile(req.params.id, fileRecord));
    }

    logActivity({
      project_id: req.params.id,
      user_id: req.user.id,
      action: 'files_uploaded',
      details: `${savedFiles.length} file(s)`
    });

    res.status(201).json({ success: true, files: savedFiles });
  } catch (err) {
    cleanupUploadedFiles(req.files);
    next(err);
  }
});

// GET /api/projects/:id/files/:fileId — file metadata + download URL
router.get('/:id/files/:fileId', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { fileId } = req.params;
    if (!isValidId(fileId)) {
      return res.status(400).json({ success: false, error: 'Invalid file ID' });
    }

    const file = getFile(fileId);
    if (!file || file.project_id !== req.params.id) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    res.json({
      success: true,
      file: serializeFile(req.params.id, file)
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id/files/:fileId — reassign asset, category, or label
router.patch('/:id/files/:fileId', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { fileId } = req.params;
    if (!isValidId(fileId)) {
      return res.status(400).json({ success: false, error: 'Invalid file ID' });
    }

    const existing = getFile(fileId);
    if (!existing || existing.project_id !== req.params.id) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const fields = {};
    if (req.body.asset_id !== undefined) {
      if (req.body.asset_id === null || req.body.asset_id === '' || req.body.asset_id === 'null') {
        fields.asset_id = null;
      } else {
        const aid = sanitizeString(req.body.asset_id, 128);
        if (!isValidId(aid)) {
          return res.status(400).json({ success: false, error: 'Invalid asset_id' });
        }
        const asset = getAsset(aid);
        if (!asset || asset.project_id !== req.params.id) {
          return res.status(404).json({ success: false, error: 'Target asset not found in project' });
        }
        fields.asset_id = aid;
      }
    }
    if (req.body.category !== undefined) {
      const cat = sanitizeString(req.body.category, 50);
      if (cat) fields.category = cat;
    }
    if (req.body.label !== undefined) {
      const lbl = sanitizeString(req.body.label, 200);
      if (!lbl) {
        return res.status(400).json({ success: false, error: 'Label cannot be empty' });
      }
      fields.label = lbl;
    }
    if (req.body.status !== undefined) {
      const st = sanitizeString(req.body.status, 20);
      if (['WIP', 'Review', 'Approved'].includes(st)) {
        fields.status = st;
      }
    }

    const updated = updateFile(fileId, fields);
    if (fields.status) {
      logActivity({
        project_id: req.params.id,
        user_id: req.user.id,
        action: 'file_status_changed',
        details: `${updated.original_name} → ${fields.status}`
      });
    }
    res.json({ success: true, file: serializeFile(req.params.id, updated) });
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/files/:fileId/thumbnail — authenticated thumbnail image
router.get('/:id/files/:fileId/thumbnail', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { fileId } = req.params;
    if (!isValidId(fileId)) {
      return res.status(400).json({ success: false, error: 'Invalid file ID' });
    }

    const file = getFile(fileId);
    if (!file || file.project_id !== req.params.id || !file.thumbnail_path) {
      return res.status(404).json({ success: false, error: 'Thumbnail not found' });
    }

    const thumbPath = path.resolve(STORAGE_ROOT, file.thumbnail_path);
    const expectedPrefix = path.resolve(UPLOADS_DIR, req.params.id, 'thumbs') + path.sep;
    if (!thumbPath.startsWith(expectedPrefix) || !fs.existsSync(thumbPath)) {
      return res.status(404).json({ success: false, error: 'Thumbnail not found on disk' });
    }

    res.setHeader('Content-Type', getMimeType(thumbPath));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(thumbPath);
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/files/:fileId/download — stream raw file (?inline=1 for preview)
router.get('/:id/files/:fileId/download', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { fileId } = req.params;
    if (!isValidId(fileId)) {
      return res.status(400).json({ success: false, error: 'Invalid file ID' });
    }

    const file = getFile(fileId);
    if (!file || file.project_id !== req.params.id) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const filePath = path.join(UPLOADS_DIR, req.params.id, file.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on disk' });
    }

    const isInline = req.query.inline === '1' || req.query.inline === 'true';
    const disposition = isInline ? 'inline' : 'attachment';
    const safeName = file.original_name.replace(/["\r\n]/g, '_');
    const contentType = getMimeType(file.original_name, file.mime_type);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = fs.createReadStream(filePath);
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id/files/:fileId — delete file
router.delete('/:id/files/:fileId', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { fileId } = req.params;
    if (!isValidId(fileId)) {
      return res.status(400).json({ success: false, error: 'Invalid file ID' });
    }

    const file = getFile(fileId);
    if (!file || file.project_id !== req.params.id) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // Delete from disk
    const filePath = path.join(UPLOADS_DIR, req.params.id, file.stored_name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete thumbnail if exists
    if (file.thumbnail_path) {
      const thumbPath = path.join(__dirname, '..', '..', file.thumbnail_path);
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
    }

    deleteFileRecord(fileId);

    logActivity({
      project_id: req.params.id,
      user_id: req.user.id,
      action: 'file_deleted',
      details: file.original_name
    });

    res.json({ success: true, message: 'File deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
