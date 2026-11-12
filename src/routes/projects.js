const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { validateProjectId, sanitizeString, isValidId, MAX_FILE_SIZE } = require('../middleware/security');
const {
  getProject, getProjectsForUser, createProject, updateProject, deleteProject,
  isProjectMember, isProjectOwner, getAssetsByProject, getFilesByProject,
  getFilesGroupedByCategory, logActivity, getProjectActivity
} = require('../db/database');
const { getMimeType } = require('../services/fileProcessor');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const DEFAULT_MAP_PATH = path.join(__dirname, '..', '..', 'public', 'assets', 'site-map.svg');

// Multer config for map uploads
const mapStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, req.params.id, 'map');
    fs.mkdirSync(dir, { recursive: true });
    // Clear previous map files so only the latest map remains
    for (const existing of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, existing));
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `site-map${ext}`);
  }
});

const mapUpload = multer({
  storage: mapStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif'];
    if (imageExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for site maps'));
    }
  }
});

// Middleware: check project exists and user has access
function requireProjectAccess(req, res, next) {
  const projectId = req.params.id;
  if (!isValidId(projectId)) {
    return res.status(400).json({ success: false, error: 'Invalid project ID' });
  }
  const project = getProject(projectId);
  if (!project) {
    return res.status(404).json({ success: false, error: 'Project not found' });
  }
  if (!isProjectMember(projectId, req.user.id) && project.owner_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  req.project = project;
  next();
}

// GET /api/projects — list user's projects
router.get('/', (req, res, next) => {
  try {
    const projects = getProjectsForUser(req.user.id);
    res.json({ success: true, projects });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects — create new project
router.post('/', (req, res, next) => {
  try {
    const name = sanitizeString(req.body.name, 200);
    const description = sanitizeString(req.body.description, 2000);

    if (!name) {
      return res.status(400).json({ success: false, error: 'Project name is required' });
    }

    const id = uuidv4();
    const project = createProject({ id, name, description, owner_id: req.user.id });

    // Create uploads directory
    fs.mkdirSync(path.join(UPLOADS_DIR, id), { recursive: true });

    logActivity({ project_id: id, user_id: req.user.id, action: 'project_created', details: name });

    res.status(201).json({ success: true, project });
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id — get project detail
router.get('/:id', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const project = req.project;
    const assets = getAssetsByProject(project.id);
    const files = getFilesByProject(project.id);

    res.json({
      success: true,
      project: {
        ...project,
        asset_count: assets.length,
        file_count: files.length
      }
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:id — update project (owner only)
router.put('/:id', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    if (!isProjectOwner(req.params.id, req.user.id)) {
      return res.status(403).json({ success: false, error: 'Only the project owner can update' });
    }

    const fields = {};
    if (req.body.name !== undefined) {
      const name = sanitizeString(req.body.name, 200);
      if (!name) {
        return res.status(400).json({ success: false, error: 'Project name cannot be empty' });
      }
      fields.name = name;
    }
    if (req.body.description !== undefined) fields.description = sanitizeString(req.body.description, 2000);

    const project = updateProject(req.params.id, fields);

    logActivity({ project_id: req.params.id, user_id: req.user.id, action: 'project_updated', details: JSON.stringify(fields) });

    res.json({ success: true, project });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id — delete project (owner only)
router.delete('/:id', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    if (!isProjectOwner(req.params.id, req.user.id)) {
      return res.status(403).json({ success: false, error: 'Only the project owner can delete' });
    }

    // Delete uploaded files on disk
    const projectDir = path.join(UPLOADS_DIR, req.params.id);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }

    deleteProject(req.params.id);

    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/upload-map — upload site map image (auto-converts TIFF to PNG)
router.post('/:id/upload-map', validateProjectId, requireProjectAccess, mapUpload.single('map'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No map file uploaded' });
    }

    const ext = path.extname(req.file.path).toLowerCase();
    if (ext === '.tif' || ext === '.tiff') {
      const pngPath = path.join(path.dirname(req.file.path), 'site-map.png');
      await sharp(req.file.path).png().toFile(pngPath);
      try { fs.unlinkSync(req.file.path); } catch {}
    }

    const mapUrl = `/api/projects/${req.params.id}/map`;
    updateProject(req.params.id, { map_path: mapUrl });

    logActivity({ project_id: req.params.id, user_id: req.user.id, action: 'map_uploaded', details: req.file.originalname });

    res.json({ success: true, map_path: mapUrl, path: mapUrl });
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/map — authenticated map serving (falls back to default site-map.svg)
router.get('/:id/map', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const mapDir = path.join(UPLOADS_DIR, req.params.id, 'map');
    let mapFilePath = null;

    if (fs.existsSync(mapDir)) {
      const files = fs.readdirSync(mapDir).filter(f => !f.startsWith('.'));
      if (files.length > 0) {
        mapFilePath = path.join(mapDir, files[0]);
      }
    }

    if (!mapFilePath || !fs.existsSync(mapFilePath)) {
      if (fs.existsSync(DEFAULT_MAP_PATH)) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.sendFile(DEFAULT_MAP_PATH);
      }
      return res.status(404).json({ success: false, error: 'Site map not found' });
    }

    const mimeType = getMimeType(mapFilePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.sendFile(mapFilePath);
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:id/detected-labels — store deterministic PDF/CAD extracted site labels
router.put('/:id/detected-labels', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const raw = req.body.labels;
    if (!Array.isArray(raw) || raw.length > 300) {
      return res.status(400).json({ success: false, error: 'labels must be an array (max 300)' });
    }

    const cleaned = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const text = sanitizeString(String(item.text || ''), 200);
      const xPct = Number(item.xPct);
      const yPct = Number(item.yPct);
      if (!text || !Number.isFinite(xPct) || !Number.isFinite(yPct)) continue;
      cleaned.push({
        text,
        area: sanitizeString(String(item.area || ''), 80),
        zone_type: sanitizeString(String(item.zone_type || 'building'), 30),
        xPct: Math.round(Math.max(0, Math.min(100, xPct)) * 100) / 100,
        yPct: Math.round(Math.max(0, Math.min(100, yPct)) * 100) / 100
      });
    }

    const project = updateProject(req.params.id, { detected_labels: cleaned });
    logActivity({
      project_id: req.params.id,
      user_id: req.user.id,
      action: 'site_labels_extracted',
      details: `${cleaned.length} label(s)`
    });

    res.json({ success: true, detected_labels: project.detected_labels || [] });
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/activity — audit log for senior review
router.get('/:id/activity', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const activity = getProjectActivity(req.params.id, 50);
    res.json({ success: true, activity });
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/export — export full project JSON including assets and file metadata
router.get('/:id/export', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const project = req.project;
    const assets = getAssetsByProject(project.id).map(asset => ({
      ...asset,
      files: getFilesGroupedByCategory(project.id, asset.id)
    }));
    const files = getFilesByProject(project.id);

    res.json({
      success: true,
      exported_at: new Date().toISOString(),
      project: {
        ...project,
        asset_count: assets.length,
        file_count: files.length
      },
      assets,
      files
    });
  } catch (err) {
    next(err);
  }
});

// Export the access middleware so asset/file routes can use it
module.exports = router;
module.exports.requireProjectAccess = requireProjectAccess;
