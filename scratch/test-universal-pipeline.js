const assert = require('assert');

// 1. Noise check
function isSpaceNoise(text) {
  const t = String(text || '').trim();
  if (t.length <= 1) return true;
  if (/^[=\d.,+\-*/°'"()[\]\s:;%#_]+$/.test(t)) return true;
  if (/=|\b\d+[\d,.]*\s*=\s*[\d,.]*%|\b\d+[\d,.]*%\b/i.test(t)) return true;
  if (/^\d+[\d,.]*\s*M(?:TR)?$/i.test(t)) return true;
  if (/\b(?:ROAD|WIDE\s*ROAD|INTERNAL\s*ROAD|DRIVEWAY|LANE|STREET)\b/i.test(t)) return true;
  if (/^(?:DOCK|CANOPY|RAMP|SHUTTER|FIRE\s*ESCAPE|CUTOUT|COLUMN|GRID|BEAM|SLAB|STAIRCASE|LIFT|ELEVATOR|RESTROOM|TOILET|DRIVERS\s*RESTROOM(?:\s*-\s*\d+)?)$/i.test(t)) return true;
  if (/\b(HIRANANDANI|INDUSTRIAL\s*PARKS|GROUND\s*COVERAGE|TOTAL\s*PLOT\s*AREA|OVERALL\s*SITE\s*AREA|DEVELOPMENT\s*DETAILS|LAND\s*BREAKUP|OPTION|REVISION|SCALE|SHEET|DRAWING\s*NO|AS\s*PER\s*THE\s*PLINE|PATRA|PLINE|\bLINE\b|ALL\s*DIMENSIONS|DO\s*NOT\s*SCALE|PARTICULARS|DESCRIPTION|PERCENTAGE|S\.?NO\.?|NORTH|LEGEND|CLIENT|ARCHITECT|CONSULTANT|APPROVED|CHECKED|DRAWN)\b/i.test(t)) return true;
  if (/\b(AREA\s*STATEMENT|PLOT\s*AREA|BUILDING\s*AREA|MISCELLANUS\s*BUILDING\s*AREA|GREEN\s*AREA|BUILT\s*UP\s*AREA|CARPET\s*AREA)\b/i.test(t)) return true;
  if (/^(?:AS|PER|THE|OF|AND|BY|FOR|IN|AT|TO|FROM|WITH|ON|A|AN|IS|ARE|OPTION|REV|REVISION|NO|GROUND|COVERAGE|SQMT|SQM|SQFT|ACRE|ACRES|PERCENT|POR|DETAILS)$/i.test(t)) return true;
  return false;
}

// 2. Space label identification
function isSpaceCode(text) {
  const t = String(text || '').trim();
  return /^(?:(?:B|WH|PLOT|BLOCK|TOWER|WING|BAY|SHED|PHASE|PARCEL|SECTOR|ZONE|UNIT|BLDG|BUILDING|OS|OSR)[-_\s]?[A-Z0-9]+|[A-Z]{1,3}[-_\s]?\d+[A-Z]?)$/i.test(t);
}

function isSpaceFacility(text) {
  const t = String(text || '').trim();
  if (isSpaceNoise(t)) return false;
  return /\b(BUILDING|WAREHOUSE|SHED|FACTORY|PLANT|OFFICE|ADMIN|ADMINISTRATION|SECURITY\s*CABIN|GATE\s*HOUSE|GUARD\s*ROOM|SUB\s*STATION|ELECTRICAL\s*ROOM|STP|WTP|UG\s*SUMP|PUMP\s*ROOM|CANTEEN|CAFETERIA|CLUBHOUSE|AMENITY|PARKING\s*STRUCTURE|MULTI\s*LEVEL\s*PARKING|OSR|PARK|GREEN\s*BELT|LANDSCAPE|TOWN\s*HALL|CLINIC|HOSPITAL|SCHOOL|HOSTEL|AUDITORIUM|COMMUNITY\s*HALL|TEMPLE|MOSQUE|CHURCH)\b/i.test(t);
}

function isSpaceLabel(text) {
  if (isSpaceNoise(text)) return false;
  return isSpaceCode(text) || isSpaceFacility(text);
}

// Verify classification
function classifyLabel(text) {
  const u = String(text || '').toUpperCase().trim();
  if (/\b(STP|SEWAGE|WTP|SUMP|TANK|WATER)\b/.test(u)) return { zone_type: 'utility', icon: 'UTIL', shape: 'circle' };
  if (/\b(OSR|PARK|GARDEN|LANDSCAPE|LAWN|GREEN|OS-?\d+)\b/.test(u)) return { zone_type: 'landscape', icon: 'LAND', shape: 'rect' };
  if (/\b(METRO|BRIDGE|FLYOVER|VIADUCT|RAIL)\b/.test(u)) return { zone_type: 'transit', icon: 'METRO', shape: 'bridge' };
  if (/\b(ROAD|STREET|AVENUE|HIGHWAY|LANE|DRIVEWAY|ENTRY|EXIT|PATH)\b/.test(u)) return { zone_type: 'road', icon: 'ROAD', shape: 'road' };
  if (/\b(SECURITY|CABIN|GATE|CHECKPOST|GUARD|RESTROOM)\b/.test(u)) return { zone_type: 'utility', icon: 'UTIL', shape: 'rect' };
  if (/\b(SUB\s*STATION|TRANSFORMER|UG\s*SUMP|PUMP\s*ROOM|ELECTRICAL)\b/.test(u)) return { zone_type: 'utility', icon: 'UTIL', shape: 'rect' };
  if (/\b(TEMPLE|MOSQUE|CHURCH|CHAPEL|SHRINE)\b/.test(u)) return { zone_type: 'civic', icon: 'CIVIC', shape: 'rect' };
  if (/\b(ADMIN|SCHOOL|HOSPITAL|HOSTEL|CLINIC|CANTEEN)\b/.test(u)) return { zone_type: 'building', icon: 'CIVIC', shape: 'rect' };
  if (/\b(B-?\d+|WH-?\d+|BLOCK|TOWER|OFFICE|BUILDING|WING|PHASE|PARKING|WAREHOUSE|SHED|BAY|PLOT-?\d+)\b/.test(u)) return { zone_type: 'building', icon: 'BLDG', shape: 'rect' };
  return { zone_type: 'zone', icon: 'ZONE', shape: 'rect' };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Full simulation of Devrung master plan raw items
const rawLines = [
  // Sheet Header
  { text: 'GROUND COVERAGE 43,430 = 39.50%', xPct: 20, yPct: 4 },
  { text: 'OPTION 02', xPct: 80, yPct: 4 },
  { text: '1,09,687.7 SQMT [AREA = 27.10 ACRES]', xPct: 20, yPct: 10 },
  { text: 'AS PER THE PLINE PATRA LINE AREA', xPct: 20, yPct: 12 },
  { text: 'N', xPct: 90, yPct: 10 },

  // Site entities & annotations
  { text: 'OS-2', xPct: 82, yPct: 20 },
  { text: '12M WIDE ROAD', xPct: 50, yPct: 28 },
  { text: 'DOCK', xPct: 50, yPct: 30 },
  { text: 'B01', xPct: 50, yPct: 43 },
  { text: 'AREA : 17600 SQM', xPct: 50, yPct: 45 },
  { text: '269.31 M', xPct: 30, yPct: 47 },
  { text: '88.82 M', xPct: 75, yPct: 44 },
  { text: '6M WIDE ROAD', xPct: 82, yPct: 44 },
  { text: 'DRIVERS RESTROOM - 01', xPct: 85, yPct: 44 },
  { text: '12M WIDE ROAD', xPct: 45, yPct: 50 },
  { text: 'DOCK', xPct: 30, yPct: 52 },
  { text: 'B02', xPct: 30, yPct: 60 },
  { text: 'AREA : 7552 SQM', xPct: 30, yPct: 62 },
  { text: 'DOCK', xPct: 60, yPct: 52 },
  { text: 'B03', xPct: 60, yPct: 60 },
  { text: 'AREA : 12915 SQM', xPct: 60, yPct: 62 },
  { text: 'DOCK', xPct: 40, yPct: 75 },
  { text: 'B04', xPct: 45, yPct: 75 },
  { text: 'AREA : 5362 SQM', xPct: 45, yPct: 77 },
  { text: '6M WIDE ROAD', xPct: 45, yPct: 86 },

  // Bottom table
  { text: 'AREA STATEMENT (OPTION 2)', xPct: 75, yPct: 90 },
  { text: 'PLOT AREA 109688', xPct: 75, yPct: 92 },
  { text: 'BUILDING AREA 43430', xPct: 75, yPct: 93 },
  { text: 'MISCELLANUS BUILDING AREA 584', xPct: 75, yPct: 94 },
  { text: 'OS 10500', xPct: 75, yPct: 95 },
  { text: 'GREEN AREA 20440', xPct: 75, yPct: 96 },

  // Title Block
  { text: 'HIRANANDANI INDUSTRIAL PARKS', xPct: 20, yPct: 98 },
  { text: 'MASTER PLAN (OPTION - 2) DATE - 07-11-2026', xPct: 50, yPct: 98 },
  { text: 'rsb', xPct: 85, yPct: 98 },
];

// Closed vector polygons extracted from PDF
const siteParcels = [
  // 4 real buildings
  { id: 'poly_b01', polygon: [[20, 32], [80, 32], [80, 48], [20, 48]], bbox: { x: '20%', y: '32%', w: '60%', h: '16%' }, area: 17600 },
  { id: 'poly_b02', polygon: [[18, 52], [42, 52], [42, 68], [18, 68]], bbox: { x: '18%', y: '52%', w: '24%', h: '16%' }, area: 7552 },
  { id: 'poly_b03', polygon: [[48, 52], [78, 52], [78, 68], [48, 68]], bbox: { x: '48%', y: '52%', w: '30%', h: '16%' }, area: 12915 },
  { id: 'poly_b04', polygon: [[38, 70], [52, 70], [52, 85], [38, 85]], bbox: { x: '38%', y: '70%', w: '14%', h: '15%' }, area: 5362 },
  // 1 OS plot
  { id: 'poly_os2', polygon: [[75, 15], [90, 15], [90, 28], [75, 28]], bbox: { x: '75%', y: '15%', w: '15%', h: '13%' }, area: 10500 },

  // Background CAD lines / unlabelled polygons:
  { id: 'poly_dock1', polygon: [[20, 29], [80, 29], [80, 32], [20, 32]], bbox: { x: '20%', y: '29%', w: '60%', h: '3%' }, area: 180 },
  { id: 'poly_dock2', polygon: [[18, 49], [42, 49], [42, 52], [18, 52]], bbox: { x: '18%', y: '49%', w: '24%', h: '3%' }, area: 72 },
  { id: 'poly_dock3', polygon: [[48, 49], [78, 49], [78, 52], [48, 52]], bbox: { x: '48%', y: '49%', w: '30%', h: '3%' }, area: 90 },
  { id: 'poly_dock4', polygon: [[35, 70], [38, 70], [38, 85], [35, 85]], bbox: { x: '35%', y: '70%', w: '3%', h: '15%' }, area: 45 },
  // Road polygons / table cells / curbs:
  { id: 'poly_road1', polygon: [[10, 25], [90, 25], [90, 29], [10, 29]], bbox: { x: '10%', y: '25%', w: '80%', h: '4%' }, area: 320 },
  { id: 'poly_table', polygon: [[70, 89], [95, 89], [95, 97], [70, 97]], bbox: { x: '70%', y: '89%', w: '25%', h: '8%' }, area: 200 },
];

const AREA_RE = /(\d[\d,.]*\s*(?:SQ\.?\s*M|SQM|M2|SQ\.?\s*FT|SQFT|ACRES?|HECTARES?|HA)\b)/i;

// Site ROI bounding box: site elements are within 10% to 90% X, 15% to 88% Y
const siteRoi = { minX: 10, minY: 15, maxX: 90, maxY: 88 };

// Area token check: matches lines like "AREA : 17600 SQM", "17600 SQM", "7552 SQM"
function extractPureAreaLine(text) {
  const t = String(text || '').trim();
  const cleaned = t.replace(/^(?:AREA|BUILT\s*UP\s*AREA|PLOT\s*AREA)?\s*[:=]?\s*/i, '').trim();
  const m = cleaned.match(AREA_RE);
  if (m && cleaned.replace(AREA_RE, '').trim().length === 0) {
    return m[1].trim();
  }
  return null;
}

// --- PIPELINE EXECUTION ---
// 1. Separate Area tokens from labels
const candidateLabels = [];
const areaTokens = [];

for (const line of rawLines) {
  const t = line.text.trim();
  // Filter out elements outside site ROI (title blocks, summary tables at bottom)
  if (line.yPct < siteRoi.minY || line.yPct > siteRoi.maxY || line.xPct < siteRoi.minX || line.xPct > siteRoi.maxX) {
    continue;
  }

  const pureArea = extractPureAreaLine(t);
  if (pureArea) {
    areaTokens.push({ area: pureArea, xPct: line.xPct, yPct: line.yPct });
    continue;
  }

  // Check if it's a valid space label
  if (isSpaceLabel(t)) {
    const areaMatch = t.match(AREA_RE);
    candidateLabels.push({
      text: t.replace(AREA_RE, '').replace(/[:=\-]$/, '').trim(),
      xPct: line.xPct,
      yPct: line.yPct,
      area: areaMatch ? areaMatch[1].trim() : '',
      claimed: false,
    });
  }
}

// 2. Associate Area tokens with candidate labels inside the same space
for (const tok of areaTokens) {
  let best = null;
  let bestDist = Infinity;
  for (const cand of candidateLabels) {
    if (cand.area) continue;
    const dx = Math.abs(cand.xPct - tok.xPct);
    const dy = tok.yPct - cand.yPct;
    if (dx <= 6 && dy >= -1 && dy <= 5) {
      const d = dx + Math.abs(dy);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
  }
  if (best) {
    best.area = tok.area;
  }
}

console.log('Candidate Space Labels found:', candidateLabels.map(c => `${c.text} (${c.area || 'no area'})`));

// 3. For each label, bind to its enclosing vector polygon shape!
// "locate the labels and create the assets based on their shape and done .dont create any new assets which does not exists"
const finalAssets = [];
const claimedParcelIds = new Set();

for (const cand of candidateLabels) {
  // Find enclosing polygon
  let bestParcel = null;
  let bestArea = Infinity;

  for (const parcel of siteParcels) {
    if (claimedParcelIds.has(parcel.id)) continue;
    if (pointInPoly(cand.xPct, cand.yPct, parcel.polygon)) {
      if (parcel.area >= 6 && parcel.area < bestArea) {
        bestArea = parcel.area;
        bestParcel = parcel;
      }
    }
  }

  // If not found, try small offset
  if (!bestParcel) {
    const offsets = [[0, 1.2], [0, -1.2], [1.5, 0], [-1.5, 0]];
    for (const [dx, dy] of offsets) {
      for (const parcel of siteParcels) {
        if (claimedParcelIds.has(parcel.id)) continue;
        if (pointInPoly(cand.xPct + dx, cand.yPct + dy, parcel.polygon)) {
          if (parcel.area >= 6 && parcel.area < bestArea) {
            bestArea = parcel.area;
            bestParcel = parcel;
          }
        }
      }
      if (bestParcel) break;
    }
  }

  // If no enclosing shape exists, DO NOT CREATE AN ASSET!
  if (!bestParcel) continue;

  claimedParcelIds.add(bestParcel.id);
  const cls = classifyLabel(cand.text);
  const cx = parseFloat(bestParcel.bbox.x) + parseFloat(bestParcel.bbox.w) / 2;
  const cy = parseFloat(bestParcel.bbox.y) + parseFloat(bestParcel.bbox.h) / 2;

  finalAssets.push({
    title: cand.text.trim(),
    area: cand.area || '',
    zone_type: cls.zone_type,
    icon: cls.icon,
    shape: 'polygon',
    polygon: bestParcel.polygon,
    bbox: bestParcel.bbox,
    xPct: Math.round(cx * 100) / 100,
    yPct: Math.round(cy * 100) / 100,
  });
}

console.log('\n--- EXTRACTED ASSETS RESULT ---');
console.log('Total Assets Count:', finalAssets.length);
console.log(finalAssets.map(a => `${a.title} [${a.zone_type}] - ${a.area || 'No Area'}`));

// ASSERTIONS:
assert.strictEqual(finalAssets.length, 5, `Expected exactly 5 assets, got ${finalAssets.length}`);
assert.deepStrictEqual(finalAssets.map(a => a.title), ['OS-2', 'B01', 'B02', 'B03', 'B04']);

const b01 = finalAssets.find(a => a.title === 'B01');
assert.strictEqual(b01.area, '17600 SQM');
assert.strictEqual(b01.zone_type, 'building');

const b02 = finalAssets.find(a => a.title === 'B02');
assert.strictEqual(b02.area, '7552 SQM');

const b03 = finalAssets.find(a => a.title === 'B03');
assert.strictEqual(b03.area, '12915 SQM');

const b04 = finalAssets.find(a => a.title === 'B04');
assert.strictEqual(b04.area, '5362 SQM');

const os2 = finalAssets.find(a => a.title === 'OS-2');
assert.strictEqual(os2.zone_type, 'landscape');

console.log('\nALL UNIVERSAL PIPELINE TESTS PASSED 100% PERFECTLY!');

// TEST PROJECT 2: Corporate Campus / Commercial Layout
const rawLinesProject2 = [
  { text: 'MASTER PLAN - COMMERCIAL TECH PARK', xPct: 50, yPct: 5 },
  { text: 'BLOCK A', xPct: 25, yPct: 35 },
  { text: 'AREA: 45000 SQFT', xPct: 25, yPct: 37 },
  { text: 'BLOCK B', xPct: 65, yPct: 35 },
  { text: 'AREA: 52000 SQFT', xPct: 65, yPct: 37 },
  { text: 'SECURITY CABIN', xPct: 15, yPct: 80 },
  { text: 'SUB STATION', xPct: 85, yPct: 80 },
  { text: '24M WIDE MAIN ROAD', xPct: 50, yPct: 82 },
  { text: 'PARKING BAY - 01', xPct: 50, yPct: 60 },
  { text: 'TOTAL BUILT-UP AREA: 97000 SQFT', xPct: 50, yPct: 95 },
];

const siteParcelsProject2 = [
  { id: 'poly_blockA', polygon: [[15, 25], [35, 25], [35, 45], [15, 45]], bbox: { x: '15%', y: '25%', w: '20%', h: '20%' }, area: 400 },
  { id: 'poly_blockB', polygon: [[55, 25], [75, 25], [75, 45], [55, 45]], bbox: { x: '55%', y: '25%', w: '20%', h: '20%' }, area: 400 },
  { id: 'poly_sec', polygon: [[12, 75], [18, 75], [18, 85], [12, 85]], bbox: { x: '12%', y: '75%', w: '6%', h: '10%' }, area: 60 },
  { id: 'poly_sub', polygon: [[82, 75], [88, 75], [88, 85], [82, 85]], bbox: { x: '82%', y: '75%', w: '6%', h: '10%' }, area: 60 },
  { id: 'poly_road', polygon: [[10, 80], [90, 80], [90, 84], [10, 84]], bbox: { x: '10%', y: '80%', w: '80%', h: '4%' }, area: 320 },
];

const candP2 = [];
const areaP2 = [];
for (const line of rawLinesProject2) {
  const t = line.text.trim();
  if (line.yPct < siteRoi.minY || line.yPct > siteRoi.maxY || line.xPct < siteRoi.minX || line.xPct > siteRoi.maxX) continue;
  const pa = extractPureAreaLine(t);
  if (pa) { areaP2.push({ area: pa, xPct: line.xPct, yPct: line.yPct }); continue; }
  if (isSpaceLabel(t)) {
    candP2.push({ text: t, xPct: line.xPct, yPct: line.yPct, area: '', claimed: false });
  }
}

for (const tok of areaP2) {
  let best = null, bestDist = Infinity;
  for (const c of candP2) {
    if (c.area) continue;
    const d = Math.abs(c.xPct - tok.xPct) + Math.abs(tok.yPct - c.yPct);
    if (d < bestDist && d < 8) { bestDist = d; best = c; }
  }
  if (best) best.area = tok.area;
}

const assetsP2 = [];
for (const cand of candP2) {
  let bestParcel = null, bestArea = Infinity;
  for (const parcel of siteParcelsProject2) {
    if (pointInPoly(cand.xPct, cand.yPct, parcel.polygon) && parcel.area < bestArea) {
      bestArea = parcel.area;
      bestParcel = parcel;
    }
  }
  if (!bestParcel) continue; // No shape -> NO ASSET!
  const cls = classifyLabel(cand.text);
  assetsP2.push({ title: cand.text, area: cand.area, zone_type: cls.zone_type, parcelId: bestParcel.id });
}

console.log('\n--- PROJECT 2 TEST RESULT ---');
console.log(assetsP2);
assert.strictEqual(assetsP2.length, 4, `Project 2 must have exactly 4 assets, got ${assetsP2.length}`);
assert.deepStrictEqual(assetsP2.map(a => a.title), ['BLOCK A', 'BLOCK B', 'SECURITY CABIN', 'SUB STATION']);
assert.strictEqual(assetsP2.find(a => a.title === 'BLOCK A').area, '45000 SQFT');
assert.strictEqual(assetsP2.find(a => a.title === 'BLOCK B').area, '52000 SQFT');
assert.strictEqual(assetsP2.find(a => a.title === 'SECURITY CABIN').zone_type, 'utility');
assert.strictEqual(assetsP2.find(a => a.title === 'SUB STATION').zone_type, 'utility');
console.log('PROJECT 2 PASSED 100% PERFECTLY AS WELL!');

