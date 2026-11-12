const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'arcsite.db');

let db;

function initDB() {
  // Ensure data directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'editor',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id),
      map_path TEXT DEFAULT NULL,
      detected_labels TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'editor',
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      icon TEXT DEFAULT '🏢',
      shape TEXT DEFAULT 'rect',
      x TEXT NOT NULL DEFAULT '10%',
      y TEXT NOT NULL DEFAULT '10%',
      w TEXT NOT NULL DEFAULT '15%',
      h TEXT NOT NULL DEFAULT '12%',
      area TEXT DEFAULT '',
      status TEXT DEFAULT 'WIP',
      polygon TEXT DEFAULT NULL,
      notes TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      category TEXT DEFAULT 'General',
      label TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      file_type TEXT,
      file_size INTEGER DEFAULT 0,
      thumbnail_path TEXT DEFAULT NULL,
      metadata TEXT DEFAULT NULL,
      status TEXT DEFAULT 'WIP',
      uploaded_by TEXT REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Safe migrations for existing databases
  const projCols = db.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
  if (!projCols.includes('detected_labels')) {
    db.exec('ALTER TABLE projects ADD COLUMN detected_labels TEXT DEFAULT NULL');
  }

  const assetCols = db.prepare('PRAGMA table_info(assets)').all().map(c => c.name);
  if (!assetCols.includes('area')) db.exec("ALTER TABLE assets ADD COLUMN area TEXT DEFAULT ''");
  if (!assetCols.includes('status')) db.exec("ALTER TABLE assets ADD COLUMN status TEXT DEFAULT 'WIP'");
  if (!assetCols.includes('polygon')) db.exec('ALTER TABLE assets ADD COLUMN polygon TEXT DEFAULT NULL');
  if (!assetCols.includes('notes')) db.exec("ALTER TABLE assets ADD COLUMN notes TEXT DEFAULT ''");

  const fileCols = db.prepare('PRAGMA table_info(files)').all().map(c => c.name);
  if (!fileCols.includes('metadata')) {
    db.exec('ALTER TABLE files ADD COLUMN metadata TEXT DEFAULT NULL');
  }
  if (!fileCols.includes('status')) {
    db.exec("ALTER TABLE files ADD COLUMN status TEXT DEFAULT 'WIP'");
  }

  return db;
}

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

// ─── User helpers ────────────────────────────────────────────────

function getUserByEmail(email) {
  return getDB().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return getDB().prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(id);
}

function createUser({ id, email, password_hash, name, role }) {
  const stmt = getDB().prepare(
    'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run(id, email, password_hash, name, role || 'editor');
  return getUserById(id);
}

// ─── Project helpers ─────────────────────────────────────────────

function parseProjectRow(row) {
  if (!row) return row;
  let detected = null;
  if (row.detected_labels) {
    try { detected = JSON.parse(row.detected_labels); } catch { detected = null; }
  }
  return { ...row, detected_labels: detected };
}

function getProject(id) {
  return parseProjectRow(getDB().prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

function getProjectsForUser(userId) {
  return getDB().prepare(`
    SELECT DISTINCT p.*, 
      (SELECT COUNT(*) FROM assets WHERE project_id = p.id) as asset_count,
      (SELECT COUNT(*) FROM files WHERE project_id = p.id) as file_count
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id
    WHERE p.owner_id = ? OR pm.user_id = ?
    ORDER BY p.updated_at DESC
  `).all(userId, userId).map(parseProjectRow);
}

function createProject({ id, name, description, owner_id }) {
  const d = getDB();
  const insertProject = d.prepare(
    'INSERT INTO projects (id, name, description, owner_id) VALUES (?, ?, ?, ?)'
  );
  const insertMember = d.prepare(
    'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
  );
  const txn = d.transaction(() => {
    insertProject.run(id, name, description || '', owner_id);
    insertMember.run(id, owner_id, 'owner');
  });
  txn();
  return getProject(id);
}

function updateProject(id, fields) {
  const allowed = ['name', 'description', 'map_path', 'detected_labels'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      if (key === 'detected_labels' && fields[key] !== null && typeof fields[key] !== 'string') {
        values.push(JSON.stringify(fields[key]));
      } else {
        values.push(fields[key]);
      }
    }
  }
  if (sets.length === 0) return getProject(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  getDB().prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getProject(id);
}

function deleteProject(id) {
  getDB().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

function isProjectMember(projectId, userId) {
  const row = getDB().prepare(
    'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, userId);
  return !!row;
}

function isProjectOwner(projectId, userId) {
  const project = getProject(projectId);
  return project && project.owner_id === userId;
}

// ─── Asset helpers ───────────────────────────────────────────────

function parseAssetRow(row) {
  if (!row) return row;
  let poly = null;
  if (row.polygon) {
    try { poly = JSON.parse(row.polygon); } catch { poly = null; }
  }
  return { ...row, polygon: Array.isArray(poly) ? poly : null };
}

function getAssetsByProject(projectId) {
  return getDB().prepare(
    'SELECT * FROM assets WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(projectId).map(parseAssetRow);
}

function getAsset(id) {
  return parseAssetRow(getDB().prepare('SELECT * FROM assets WHERE id = ?').get(id));
}

function createAsset({ id, project_id, title, icon, shape, x, y, w, h, area, status, polygon, notes, sort_order }) {
  const polyJson = Array.isArray(polygon) ? JSON.stringify(polygon) : (typeof polygon === 'string' ? polygon : null);
  getDB().prepare(`
    INSERT INTO assets (id, project_id, title, icon, shape, x, y, w, h, area, status, polygon, notes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, project_id, title, icon || '🏢', shape || 'rect',
    x || '10%', y || '10%', w || '15%', h || '12%',
    area || '', status || 'WIP', polyJson, notes || '', sort_order || 0
  );
  return getAsset(id);
}

function updateAsset(id, fields) {
  const allowed = ['title', 'icon', 'shape', 'x', 'y', 'w', 'h', 'area', 'status', 'polygon', 'notes', 'sort_order'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      if (key === 'polygon' && fields[key] !== null && typeof fields[key] !== 'string') {
        values.push(JSON.stringify(fields[key]));
      } else {
        values.push(fields[key]);
      }
    }
  }
  if (sets.length === 0) return getAsset(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  getDB().prepare(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getAsset(id);
}

function deleteAsset(id) {
  getDB().prepare('DELETE FROM assets WHERE id = ?').run(id);
}

function reorderAssets(projectId, order) {
  const stmt = getDB().prepare("UPDATE assets SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?");
  const txn = getDB().transaction(() => {
    for (const item of order) {
      stmt.run(item.sort_order, item.id, projectId);
    }
  });
  txn();
}

// ─── File helpers ────────────────────────────────────────────────

function parseFileRow(row) {
  if (!row) return row;
  let parsedMeta = null;
  if (row.metadata) {
    try { parsedMeta = JSON.parse(row.metadata); } catch { parsedMeta = null; }
  }
  return { ...row, metadata: parsedMeta };
}

function getFilesByProject(projectId, filters = {}) {
  let sql = 'SELECT * FROM files WHERE project_id = ?';
  const params = [projectId];
  if (filters.asset_id) {
    sql += ' AND asset_id = ?';
    params.push(filters.asset_id);
  }
  if (filters.category) {
    sql += ' AND category = ?';
    params.push(filters.category);
  }
  sql += ' ORDER BY created_at DESC';
  return getDB().prepare(sql).all(...params).map(parseFileRow);
}

function getFile(id) {
  return parseFileRow(getDB().prepare('SELECT * FROM files WHERE id = ?').get(id));
}

function createFile({ id, project_id, asset_id, category, label, original_name, stored_name, mime_type, file_type, file_size, thumbnail_path, metadata, uploaded_by }) {
  const metaJson = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
  getDB().prepare(`
    INSERT INTO files (id, project_id, asset_id, category, label, original_name, stored_name, mime_type, file_type, file_size, thumbnail_path, metadata, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, project_id, asset_id || null, category || 'General', label, original_name, stored_name, mime_type || null, file_type || 'unknown', file_size || 0, thumbnail_path || null, metaJson, uploaded_by || null);
  return getFile(id);
}

function updateFile(id, fields) {
  const allowed = ['asset_id', 'category', 'label', 'status'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (sets.length === 0) return getFile(id);
  values.push(id);
  getDB().prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getFile(id);
}

function deleteFile(id) {
  getDB().prepare('DELETE FROM files WHERE id = ?').run(id);
}

function getFilesGroupedByCategory(projectId, assetId) {
  let sql = 'SELECT * FROM files WHERE project_id = ?';
  const params = [projectId];
  if (assetId) {
    sql += ' AND asset_id = ?';
    params.push(assetId);
  }
  sql += ' ORDER BY category, created_at DESC';
  const files = getDB().prepare(sql).all(...params).map(parseFileRow);
  const grouped = {};
  for (const file of files) {
    if (!grouped[file.category]) grouped[file.category] = [];
    grouped[file.category].push(file);
  }
  return grouped;
}

// ─── Activity log ────────────────────────────────────────────────

function logActivity({ project_id, user_id, action, details }) {
  getDB().prepare(
    'INSERT INTO activity_log (project_id, user_id, action, details) VALUES (?, ?, ?, ?)'
  ).run(project_id || null, user_id || null, action, details || null);
}

function getProjectActivity(projectId, limit = 40) {
  return getDB().prepare(`
    SELECT a.id, a.action, a.details, a.created_at, u.name as user_name, u.email as user_email
    FROM activity_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.project_id = ?
    ORDER BY a.id DESC
    LIMIT ?
  `).all(projectId, limit);
}

module.exports = {
  initDB,
  getDB,
  getUserByEmail,
  getUserById,
  createUser,
  getProject,
  getProjectsForUser,
  createProject,
  updateProject,
  deleteProject,
  isProjectMember,
  isProjectOwner,
  getAssetsByProject,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  reorderAssets,
  getFilesByProject,
  getFile,
  createFile,
  updateFile,
  deleteFile,
  getFilesGroupedByCategory,
  logActivity,
  getProjectActivity
};
