const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const sharp = require('sharp');
const { UPLOADS_DIR } = require('../config/paths');

// Extension → file_type mapping
const EXT_TYPE_MAP = {
  '.pdf': 'pdf',
  '.ifc': 'ifc',
  '.dxf': 'dxf',
  '.dwg': 'dwg',
  '.bak': 'dwg',
  '.skp': 'skp',
  '.skb': 'skp',
  '.rvt': 'rvt',
  '.rfa': 'rvt',
  '.glb': 'model3d',
  '.gltf': 'model3d',
  '.obj': 'model3d',
  '.fbx': 'model3d',
  '.3ds': 'model3d',
  '.stl': 'model3d',
  '.dae': 'model3d',
  '.3dm': 'model3d',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.bmp': 'image',
  '.doc': 'document',
  '.docx': 'document',
  '.xls': 'document',
  '.xlsx': 'document',
  '.ppt': 'document',
  '.pptx': 'document',
  '.csv': 'document',
  '.txt': 'document',
  '.md': 'document',
  '.json': 'document',
  '.xml': 'document',
  '.html': 'document',
  '.zip': 'archive',
  '.rar': 'archive',
  '.7z': 'archive',
  '.tar': 'archive',
  '.gz': 'archive'
};

const MIME_TYPE_MAP = {
  '.pdf': 'application/pdf',
  '.ifc': 'text/plain; charset=utf-8',
  '.dxf': 'text/plain; charset=utf-8',
  '.dwg': 'application/acad',
  '.bak': 'application/acad',
  '.skp': 'application/vnd.sketchup.skp',
  '.skb': 'application/vnd.sketchup.skp',
  '.rvt': 'application/octet-stream',
  '.rfa': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain; charset=utf-8',
  '.fbx': 'application/octet-stream',
  '.stl': 'model/stl',
  '.3dm': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.bmp': 'image/bmp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.zip': 'application/zip'
};

const DWG_VERSIONS = {
  AC1032: 'AutoCAD 2018-2024',
  AC1027: 'AutoCAD 2013-2017',
  AC1024: 'AutoCAD 2010-2012',
  AC1021: 'AutoCAD 2007-2009',
  AC1018: 'AutoCAD 2004-2006',
  AC1015: 'AutoCAD 2000-2002'
};

/**
 * Detect file type from file extension.
 * @param {string} filename - Original file name
 * @returns {string} file_type string
 */
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TYPE_MAP[ext] || 'unknown';
}

/**
 * Get accurate Content-Type for a file extension.
 * @param {string} filename
 * @param {string} fallback
 * @returns {string}
 */
function getMimeType(filename, fallback) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPE_MAP[ext] || fallback || 'application/octet-stream';
}

/**
 * Guess architectural studio category from filename and optional folder path.
 * @param {string} originalName
 * @param {string} [relativePath]
 * @returns {string}
 */
function getFileCategory(originalName, relativePath = '') {
  const combined = `${relativePath} ${originalName}`.toLowerCase();
  const ext = path.extname(originalName).toLowerCase();

  if (combined.includes('site plan') || combined.includes('site-plan') || combined.includes('masterplan') || combined.includes('master plan')) {
    return 'Site Plan';
  }
  if (combined.includes('presentation') || ext === '.pptx' || ext === '.ppt' || ext === '.key') {
    return 'Presentations';
  }
  if (
    combined.includes('views') ||
    combined.includes('walkthrough') ||
    combined.includes('aerial') ||
    combined.includes('render') ||
    ['.skp', '.skb', '.glb', '.gltf', '.obj', '.fbx', '.3dm', '.stl'].includes(ext)
  ) {
    return 'Views & 3D';
  }
  if (
    combined.includes('working') ||
    ['.dwg', '.bak', '.dxf'].includes(ext) ||
    combined.includes('scale model')
  ) {
    return 'Working CAD';
  }
  if (combined.includes('/ref/') || combined.includes('\\ref\\') || combined.startsWith('ref/') || combined.includes('reference') || combined.includes('whatsapp')) {
    return 'References';
  }
  if (combined.includes('arch') || combined.includes('floor plan') || combined.includes('elevation') || combined.includes('facade')) {
    return 'Architecture';
  }
  if (combined.includes('struct') || combined.includes('foundation') || combined.includes('beam') || combined.includes('column')) {
    return 'Structural';
  }
  if (
    combined.includes('mep') ||
    combined.includes('elec') ||
    combined.includes('plumb') ||
    combined.includes('hvac') ||
    combined.includes('fire') ||
    combined.includes('drain')
  ) {
    return 'MEP';
  }

  return 'General';
}

/**
 * Read up to maxBytes from the start of a file safely.
 */
function readFileHead(filePath, maxBytes = 4096) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Zero-dependency ZIP reader supporting offset-shifted archives (such as SketchUp 2021+ .skp/.skb).
 * @param {Buffer} buf
 * @param {(name: string) => boolean} matcher
 * @returns {Array<{name: string, data: Buffer}>}
 */
function extractZipEntries(buf, matcher) {
  const results = [];
  if (!Buffer.isBuffer(buf) || buf.length < 22) return results;

  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return results;

  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const firstPk = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const shifts = firstPk > 0 ? [0, firstPk] : [0];

  for (const shift of shifts) {
    let pos = cdOffset + shift;
    if (pos < 0 || pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) continue;

    for (let i = 0; i < cdCount && pos + 46 <= buf.length; i++) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;
      const compMethod = buf.readUInt16LE(pos + 10);
      const compSize = buf.readUInt32LE(pos + 20);
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localOff = buf.readUInt32LE(pos + 42) + shift;
      const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
      pos += 46 + nameLen + extraLen + commentLen;

      if (matcher(name) && localOff >= 0 && localOff + 30 <= buf.length) {
        try {
          const lNameLen = buf.readUInt16LE(localOff + 26);
          const lExtraLen = buf.readUInt16LE(localOff + 28);
          const dataStart = localOff + 30 + lNameLen + lExtraLen;
          if (dataStart + compSize <= buf.length) {
            const raw = buf.subarray(dataStart, dataStart + compSize);
            let data = null;
            if (compMethod === 0) data = raw;
            else if (compMethod === 8) data = zlib.inflateRawSync(raw);
            if (data) results.push({ name, data });
          }
        } catch {
          // Ignore malformed entry
        }
      }
    }
    if (results.length > 0) break;
  }

  return results;
}

/**
 * Scan buffer for an embedded PNG (used by AutoCAD DWG / BAK preview headers).
 */
function extractEmbeddedPng(buf) {
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const iendSig = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const start = buf.indexOf(pngSig);
  if (start < 0) return null;
  const end = buf.indexOf(iendSig, start + 8);
  if (end < 0) return null;
  return buf.subarray(start, end + 8);
}

/**
 * Extract slide count and slide text outline from a .pptx deck.
 */
function extractPptxOutline(buf) {
  const entries = extractZipEntries(buf, (name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name));
  entries.sort((a, b) => {
    const na = parseInt((a.name.match(/slide(\d+)/i) || [])[1] || '0', 10);
    const nb = parseInt((b.name.match(/slide(\d+)/i) || [])[1] || '0', 10);
    return na - nb;
  });

  const slides = entries.map((entry, idx) => {
    const xml = entry.data.toString('utf8');
    const texts = [];
    const re = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      if (t) texts.push(t);
    }
    const num = parseInt((entry.name.match(/slide(\d+)/i) || [])[1] || String(idx + 1), 10);
    return {
      slide: num,
      title: texts[0] || `Slide ${num}`,
      snippets: texts.slice(1, 6)
    };
  });

  return { slide_count: slides.length, slides: slides.slice(0, 30) };
}

/**
 * Generate or extract a visual thumbnail for images, SKP/SKB, DWG/BAK, and PPTX.
 * Returns relative path like "uploads/<projectId>/thumbs/<fileId>.png" or null.
 */
async function extractFileThumbnail(filePath, originalName, projectId, fileId) {
  const ext = path.extname(originalName).toLowerCase();
  const fileType = getFileType(originalName);
  const thumbDir = path.join(UPLOADS_DIR, projectId, 'thumbs');

  try {
    if (fileType === 'image' && ext !== '.svg') {
      fs.mkdirSync(thumbDir, { recursive: true });
      const thumbName = `${fileId}.webp`;
      const outPath = path.join(thumbDir, thumbName);
      await sharp(filePath)
        .rotate()
        .resize(420, 420, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outPath);
      return path.posix.join('uploads', projectId, 'thumbs', thumbName);
    }

    if (ext === '.skp' || ext === '.skb') {
      const buf = fs.readFileSync(filePath);
      const entries = extractZipEntries(
        buf,
        (n) => n === 'meta/model_thumbnail.png' || n === 'doc_thumbnail.png'
      );
      if (entries.length > 0 && entries[0].data.length > 16) {
        fs.mkdirSync(thumbDir, { recursive: true });
        const thumbName = `${fileId}.png`;
        fs.writeFileSync(path.join(thumbDir, thumbName), entries[0].data);
        return path.posix.join('uploads', projectId, 'thumbs', thumbName);
      }
    }

    if (ext === '.dwg' || ext === '.bak') {
      const headBuf = readFileHead(filePath, 2 * 1024 * 1024);
      const pngBuf = extractEmbeddedPng(headBuf);
      if (pngBuf && pngBuf.length > 16) {
        fs.mkdirSync(thumbDir, { recursive: true });
        const thumbName = `${fileId}.png`;
        fs.writeFileSync(path.join(thumbDir, thumbName), pngBuf);
        return path.posix.join('uploads', projectId, 'thumbs', thumbName);
      }
    }

    if (ext === '.pptx') {
      const buf = fs.readFileSync(filePath);
      const entries = extractZipEntries(buf, (n) => /^docProps\/thumbnail\.(jpeg|jpg|png)$/i.test(n));
      if (entries.length > 0 && entries[0].data.length > 16) {
        fs.mkdirSync(thumbDir, { recursive: true });
        const imgExt = path.extname(entries[0].name).toLowerCase() || '.jpeg';
        const thumbName = `${fileId}${imgExt}`;
        fs.writeFileSync(path.join(thumbDir, thumbName), entries[0].data);
        return path.posix.join('uploads', projectId, 'thumbs', thumbName);
      }
    }
  } catch {
    // Best-effort thumbnailing — never fail upload
  }

  return null;
}

/**
 * Extract basic metadata for uploaded architectural/CAD/BIM/image/presentation files.
 * @param {string} filePath
 * @param {string} originalName
 * @param {string} [relativePath]
 * @returns {Promise<object>}
 */
async function extractFileMetadata(filePath, originalName, relativePath = '') {
  const ext = path.extname(originalName).toLowerCase();
  const fileType = getFileType(originalName);
  const meta = { extension: ext, file_type: fileType };

  if (ext === '.skb' || ext === '.bak') {
    meta.is_backup = true;
  }
  if (relativePath && relativePath.includes('/')) {
    const dir = path.posix.dirname(relativePath.replace(/\\/g, '/'));
    if (dir && dir !== '.') meta.folder = dir;
  }

  try {
    if (fileType === 'image' && ext !== '.svg') {
      const info = await sharp(filePath).metadata();
      if (info.width) meta.width = info.width;
      if (info.height) meta.height = info.height;
      if (info.format) meta.format = info.format;
      if (info.channels) meta.channels = info.channels;
      return meta;
    }

    if (ext === '.svg') {
      const head = readFileHead(filePath, 2048).toString('utf8');
      meta.software = 'Scalable Vector Graphics (SVG)';
      const vb = head.match(/viewBox=["']([^"']+)["']/i);
      if (vb) meta.viewBox = vb[1];
      return meta;
    }

    const headBuf = readFileHead(filePath, 4096);
    const headAscii = headBuf.toString('latin1');
    const headUtf8 = headBuf.toString('utf8');

    if (ext === '.skp' || ext === '.skb') {
      meta.software = ext === '.skb' ? 'SketchUp Backup (.skb)' : 'SketchUp Model (.skp)';
      const clean = headBuf.toString('utf16le').replace(/\0/g, '');
      const verMatch = clean.match(/SketchUp Model.*?(\d+(?:\.\d+)*)/i) || headAscii.match(/SketchUp\s*Model/i);
      if (verMatch) meta.header = verMatch[0].slice(0, 80);
    } else if (ext === '.dwg' || ext === '.bak') {
      meta.software = ext === '.bak' ? 'AutoCAD Drawing Backup (.bak)' : 'AutoCAD DWG';
      const sig = headAscii.slice(0, 6);
      if (sig.startsWith('AC')) {
        meta.dwg_code = sig;
        meta.version = DWG_VERSIONS[sig] || sig;
      }
    } else if (ext === '.dxf') {
      meta.software = 'AutoCAD DXF (2D/3D CAD)';
      const ver = headUtf8.match(/\$ACADVER[\r\n]+\s*1[\r\n]+\s*([A-Z0-9]+)/);
      if (ver) meta.acad_version = ver[1];
      meta.encoding = headUtf8.includes('ENTITIES') || headUtf8.includes('SECTION') ? 'ASCII DXF' : 'Binary/Partial DXF';
      if (meta.encoding === 'ASCII DXF' && fs.statSync(filePath).size <= 15 * 1024 * 1024) {
        const dxfText = fs.readFileSync(filePath, 'utf8');
        const labels = [];
        const lines = dxfText.split(/\r?\n/);
        for (let i = 0; i < lines.length - 1 && labels.length < 40; i += 2) {
          if (lines[i].trim() === '1' && i >= 2) {
            const val = lines[i + 1].trim().replace(/\\[A-Za-z][^;]*;/g, '').trim();
            if (val && val.length >= 2 && val.length <= 60 && !labels.includes(val)) {
              labels.push(val);
            }
          }
        }
        if (labels.length > 0) meta.detected_text = labels;
      }
    } else if (ext === '.ifc') {
      meta.software = 'IFC BIM (ISO 16739)';
      const schema = headUtf8.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
      const appMatch = headUtf8.match(/FILE_NAME\s*\([^)]*?'([^']*)'\s*\)/i);
      if (schema) meta.ifc_schema = schema[1];
      if (appMatch) meta.authoring_info = appMatch[1];
    } else if (ext === '.rvt' || ext === '.rfa') {
      meta.software = ext === '.rfa' ? 'Autodesk Revit Family (.rfa)' : 'Autodesk Revit Project (.rvt)';
      meta.container = headBuf.subarray(0, 4).toString('hex') === 'd0cf11e0' ? 'OLE Compound Document' : 'Revit Binary';
    } else if (ext === '.3dm') {
      meta.software = 'McNeel Rhino 3D (.3dm)';
      const rhinoMatch = headAscii.match(/3D Geometry File Format\s*(\d+)/i);
      if (rhinoMatch) meta.version = `Rhino v${rhinoMatch[1]}`;
    } else if (ext === '.pdf') {
      meta.software = 'PDF Document';
      const pdfVer = headAscii.match(/%PDF-(\d+\.\d+)/);
      if (pdfVer) meta.pdf_version = pdfVer[1];
    } else if (ext === '.glb') {
      meta.software = 'glTF Binary (.glb)';
      if (headAscii.startsWith('glTF')) {
        meta.gltf_version = headBuf.readUInt32LE(4);
      }
    } else if (ext === '.pptx') {
      meta.software = 'Microsoft PowerPoint (.pptx)';
      const fullBuf = fs.readFileSync(filePath);
      const outline = extractPptxOutline(fullBuf);
      meta.slide_count = outline.slide_count;
      meta.slides = outline.slides;
    }
  } catch (err) {
    meta.metadata_warning = err.message;
  }

  return meta;
}

module.exports = {
  getFileType,
  getMimeType,
  getFileCategory,
  extractFileMetadata,
  extractFileThumbnail,
  EXT_TYPE_MAP,
  MIME_TYPE_MAP
};
