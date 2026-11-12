const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { validateProjectId, sanitizeString, isValidId } = require('../middleware/security');
const { requireProjectAccess } = require('./projects');
const {
  getDB, getAssetsByProject, getAsset, createAsset, updateAsset, deleteAsset,
  reorderAssets, getFilesGroupedByCategory, getFile, updateFile, logActivity
} = require('../db/database');

const router = express.Router();
const VALID_STATUSES = new Set(['WIP', 'Review', 'Approved']);
const VALID_SHAPES = new Set(['rect', 'circle', 'bridge', 'road', 'polygon']);

function normalizeStatus(val) {
  const s = sanitizeString(String(val || ''), 20);
  return VALID_STATUSES.has(s) ? s : 'WIP';
}

function normalizeShape(val) {
  const s = sanitizeString(String(val || ''), 20);
  return VALID_SHAPES.has(s) ? s : 'rect';
}

function sanitizeIcon(val) {
  const str = sanitizeString(val, 10);
  if (!str) return 'BLDG';
  const clean = str.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g, '').trim();
  return clean || 'BLDG';
}

function sanitizePolygon(raw) {
  if (!raw) return null;
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(arr) || arr.length < 3 || arr.length > 60) return null;
  const cleaned = [];
  for (const pt of arr) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      cleaned.push([
        Math.round(Math.max(0, Math.min(100, x)) * 100) / 100,
        Math.round(Math.max(0, Math.min(100, y)) * 100) / 100
      ]);
    }
  }
  return cleaned.length >= 3 ? cleaned : null;
}

// GET /api/projects/:id/assets — list assets with files grouped by category
router.get('/:id/assets', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const assets = getAssetsByProject(req.params.id);

    const enriched = assets.map(asset => {
      const filesByCategory = getFilesGroupedByCategory(req.params.id, asset.id);
      return { ...asset, files: filesByCategory };
    });

    res.json({ success: true, assets: enriched });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/assets — create asset
router.post('/:id/assets', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const title = sanitizeString(req.body.title, 200);
    if (!title) {
      return res.status(400).json({ success: false, error: 'Asset title is required' });
    }

    const polygon = sanitizePolygon(req.body.polygon);
    const id = uuidv4();
    const asset = createAsset({
      id,
      project_id: req.params.id,
      title,
      icon: sanitizeIcon(req.body.icon),
      shape: polygon ? 'polygon' : normalizeShape(req.body.shape),
      x: sanitizeString(req.body.x, 20) || '10%',
      y: sanitizeString(req.body.y, 20) || '10%',
      w: sanitizeString(req.body.w, 20) || '15%',
      h: sanitizeString(req.body.h, 20) || '12%',
      area: sanitizeString(req.body.area, 100),
      status: normalizeStatus(req.body.status),
      polygon,
      notes: sanitizeString(req.body.notes, 1000),
      sort_order: parseInt(req.body.sort_order, 10) || 0
    });

    logActivity({ project_id: req.params.id, user_id: req.user.id, action: 'asset_created', details: title });

    res.status(201).json({ success: true, asset });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/assets/batch — transactional batch create (used by Smart Assist)
router.post('/:id/assets/batch', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const items = req.body.assets;
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      return res.status(400).json({ success: false, error: 'assets must be a non-empty array (max 100)' });
    }

    const created = [];
    const linkedFiles = [];

    const txn = getDB().transaction(() => {
      for (const item of items) {
        const title = sanitizeString(item && item.title, 200);
        if (!title) continue;
        const polygon = sanitizePolygon(item.polygon);
        const asset = createAsset({
          id: uuidv4(),
          project_id: req.params.id,
          title,
          icon: sanitizeIcon(item.icon),
          shape: polygon ? 'polygon' : normalizeShape(item.shape),
          x: sanitizeString(item.x, 20) || '10%',
          y: sanitizeString(item.y, 20) || '10%',
          w: sanitizeString(item.w, 20) || '14%',
          h: sanitizeString(item.h, 20) || '12%',
          area: sanitizeString(item.area, 100),
          status: normalizeStatus(item.status),
          polygon,
          notes: sanitizeString(item.notes, 1000),
          sort_order: parseInt(item.sort_order, 10) || 0
        });
        created.push(asset);

        if (Array.isArray(item.matched_file_ids)) {
          for (const fid of item.matched_file_ids) {
            if (!isValidId(String(fid))) continue;
            const file = getFile(String(fid));
            if (file && file.project_id === req.params.id) {
              linkedFiles.push(updateFile(file.id, { asset_id: asset.id }));
            }
          }
        }
      }
    });

    txn();

    logActivity({
      project_id: req.params.id,
      user_id: req.user.id,
      action: 'assets_batch_created',
      details: `${created.length} zone(s), ${linkedFiles.length} file link(s)`
    });

    res.status(201).json({ success: true, assets: created, linked_files: linkedFiles });
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:id/assets/reorder — batch reorder (must come before :assetId route)
router.put('/:id/assets/reorder', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, error: 'order must be an array of {id, sort_order}' });
    }

    reorderAssets(req.params.id, order);

    const assets = getAssetsByProject(req.params.id);
    res.json({ success: true, assets });
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:id/assets/:assetId — update asset
router.put('/:id/assets/:assetId', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { assetId } = req.params;
    if (!isValidId(assetId)) {
      return res.status(400).json({ success: false, error: 'Invalid asset ID' });
    }

    const existing = getAsset(assetId);
    if (!existing || existing.project_id !== req.params.id) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    const fields = {};
    const stringFields = ['title', 'icon', 'x', 'y', 'w', 'h', 'area', 'notes'];
    for (const key of stringFields) {
      if (req.body[key] !== undefined) {
        const val = sanitizeString(String(req.body[key]), key === 'notes' ? 1000 : 200);
        if (key === 'title' && !val) {
          return res.status(400).json({ success: false, error: 'Asset title cannot be empty' });
        }
        fields[key] = val;
      }
    }
    if (req.body.shape !== undefined) fields.shape = normalizeShape(req.body.shape);
    if (req.body.status !== undefined) fields.status = normalizeStatus(req.body.status);
    if (req.body.sort_order !== undefined) fields.sort_order = parseInt(req.body.sort_order, 10) || 0;
    if (req.body.polygon !== undefined) {
      fields.polygon = req.body.polygon === null ? null : sanitizePolygon(req.body.polygon);
    }

    const asset = updateAsset(assetId, fields);

    logActivity({ project_id: req.params.id, user_id: req.user.id, action: 'asset_updated', details: asset.title });

    res.json({ success: true, asset });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id/assets/:assetId — delete asset
router.delete('/:id/assets/:assetId', validateProjectId, requireProjectAccess, (req, res, next) => {
  try {
    const { assetId } = req.params;
    if (!isValidId(assetId)) {
      return res.status(400).json({ success: false, error: 'Invalid asset ID' });
    }

    const existing = getAsset(assetId);
    if (!existing || existing.project_id !== req.params.id) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    deleteAsset(assetId);

    logActivity({ project_id: req.params.id, user_id: req.user.id, action: 'asset_deleted', details: existing.title });

    res.json({ success: true, message: 'Asset deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
