// Test suite for label priority, road width rejection, and badge collision avoidance
const assert = require('assert');

// 1. Test Road Noise and Dimensions
const ROAD_DIM_RE = /\b(?:\d+(\.\d+)?\s*M(?:TR)?\s*(?:WIDE)?\s*ROAD|\d+(\.\d+)?\s*M(?:TR)?\s*WIDE|WIDE\s*ROAD|INTERNAL\s*ROAD|ROAD\s*WIDTH|\d+\.?\d*\s*M\s*WIDE)\b/i;

function isArchitecturalKeyword(text) {
  const u = String(text || '').trim().toUpperCase();
  if (/\b\d+(\.\d+)?\s*M\b/.test(u)) return false;
  if (/^(?:ROAD|WIDE\s*ROAD|INTERNAL\s*ROAD|DOCK|CANOPY|RAMP)$/i.test(u)) return false;
  return /\b(BUILDING|BLOCK|TOWER|WAREHOUSE|SHED|BAY|SECURITY|CABIN|GATE|SUB\s*STATION|TRANSFORMER|UG\s*SUMP|PUMP\s*ROOM|STP|WTP|OSR|GREEN\s*BELT|LANDSCAPE|PARKING|ENTRY|EXIT|WEIGH\s*BRIDGE|CANTEEN|ADMIN|OFFICE|TEMPLE|MOSQUE|METRO|BRIDGE)\b/.test(u);
}

// Test road dimension rejection
const roads = [
  '12M WIDE ROAD',
  '6M WIDE ROAD',
  '18M WIDE ROAD',
  '9.5M WIDE ROAD',
  'INTERNAL ROAD',
  'WIDE ROAD',
];

for (const r of roads) {
  assert.ok(ROAD_DIM_RE.test(r), `ROAD_DIM_RE should match ${r}`);
  assert.strictEqual(isArchitecturalKeyword(r), false, `isArchitecturalKeyword should reject ${r}`);
}

// Named road like MOUNT ROAD
assert.strictEqual(ROAD_DIM_RE.test('MOUNT ROAD'), false, 'MOUNT ROAD is not dimension noise');

// 2. Test Building B01 Priority inside parcel
function resolveParcelTitleAndArea(inside, parcel, bldgCounter = 1) {
  let title = '';
  let area = '';

  const bboxW = parseFloat(parcel.bbox.w || 0);
  const bboxH = parseFloat(parcel.bbox.h || 0);
  const isDockStrip = parcel.category === 'building' && (bboxW / Math.max(0.1, bboxH) > 4.2 || bboxH / Math.max(0.1, bboxW) > 4.2) && (parcel.area < 4000);
  const isLargeBuilding = parcel.category === 'building' && !isDockStrip && (parcel.area > 2500 || (bboxH > 6 && bboxW > 10));

  if (inside.length > 0) {
    const codeToken = inside.find((c) =>
      /^(?:B-?\d+[A-Z]?|WH-?\d+[A-Z]?|PLOT-?\d+|BAY-?\d+|SHED-?\d+|TOWER\s*[A-Z0-9]+|BLOCK\s*[A-Z0-9]+)$/i.test(c.text.trim())
    );

    const primaryBuilding = inside.find((c) =>
      /\b(BUILDING|BLOCK|WAREHOUSE|SHED|BAY|FACILITY|OFFICE|ADMIN|SECURITY|CABIN|STP|WTP|SUB\s*STATION|TEMPLE|CANTEEN)\b/i.test(c.text) &&
      !/\b(DOCK|ROAD|RESTROOM|CANOPY|RAMP)\b/i.test(c.text)
    );

    const generalText = inside.find((c) => {
      const t = c.text.trim();
      if (t.length < 3) return false;
      if (isLargeBuilding && /^(?:DOCK|CANOPY|RAMP|SHUTTER)$/i.test(t)) return false;
      return !/^\d+$/.test(t.replace(/\D/g, ''));
    });

    const attachmentText = inside.find((c) => /\b(DOCK|CANOPY|RAMP|RESTROOM)\b/i.test(c.text));
    const matchedCand = codeToken || primaryBuilding || generalText || attachmentText;

    if (matchedCand) {
      const raw = matchedCand.text.trim();
      if (/^B-?\d+[A-Z]?$/i.test(raw)) {
        title = 'Building ' + raw.toUpperCase();
      } else if (/^WH-?\d+[A-Z]?$/i.test(raw)) {
        title = 'Warehouse ' + raw.toUpperCase();
      } else if (/^DOCK$/i.test(raw)) {
        title = isLargeBuilding ? `Building 0${bldgCounter}` : 'Loading Dock';
      } else {
        title = raw;
      }
      area = matchedCand.area || (inside.find((c) => c.area)?.area || '');
    }
  } else {
    if (isDockStrip) {
      title = 'Loading Dock';
    } else if (parcel.category === 'building') {
      title = `Building 0${bldgCounter}`;
    }
  }

  return { title, area };
}

// Warehouse B01 test with DOCK also present inside candidate pool
const warehouseParcel = {
  category: 'building',
  area: 17600,
  bbox: { x: '25%', y: '38%', w: '55%', h: '22%' },
};

const warehouseCandidates = [
  { text: 'DOCK', area: '' },
  { text: 'B01', area: '' },
  { text: 'AREA = 17600 SQM', area: '17600 SQM' },
];

const resWarehouse = resolveParcelTitleAndArea(warehouseCandidates, warehouseParcel, 1);
assert.strictEqual(resWarehouse.title, 'Building B01', 'Warehouse should be titled Building B01');
assert.strictEqual(resWarehouse.area, '17600 SQM', 'Warehouse area should be 17600 SQM');

// Dock Canopy test
const dockParcel = {
  category: 'building',
  area: 1500,
  bbox: { x: '25%', y: '34%', w: '55%', h: '3.5%' },
};

const dockCandidates = [
  { text: 'DOCK', area: '' },
];

const resDock = resolveParcelTitleAndArea(dockCandidates, dockParcel, 2);
assert.strictEqual(resDock.title, 'Loading Dock', 'Dock strip should be titled Loading Dock');

// Dock Canopy with no inside text
const resDockEmpty = resolveParcelTitleAndArea([], dockParcel, 2);
assert.strictEqual(resDockEmpty.title, 'Loading Dock', 'Dock strip with no inside text should be titled Loading Dock');

// 3. Test Badge Collision Avoidance Algorithm
function computeBadgeLayouts(assets) {
  const badgeLayouts = {};
  const placedBadges = [];

  const sortedAssets = [...assets].sort((a, b) => {
    const areaA = parseFloat(a.area) || (parseFloat(a.w || 0) * parseFloat(a.h || 0));
    const areaB = parseFloat(b.area) || (parseFloat(b.w || 0) * parseFloat(b.h || 0));
    return areaB - areaA;
  });

  for (const a of sortedAssets) {
    const ax = parseFloat(a.x);
    const ay = parseFloat(a.y);
    const aw = parseFloat(a.w);
    const ah = parseFloat(a.h);

    const cx = ax + aw / 2;
    const cy = ay + ah / 2;

    const titleText = a.title || '';
    const areaText = a.area || '';
    const badgeCharCount = titleText.length + (areaText ? areaText.length + 3 : 0);
    const badgeW = Math.max(8.0, Math.min(22.0, badgeCharCount * 0.65 + 4.5));
    const badgeH = 3.8;
    const halfW = badgeW / 2;
    const halfH = badgeH / 2;

    const candidates = [
      [cx, cy],
      [cx, cy + badgeH * 1.05],
      [cx, cy - badgeH * 1.05],
      [cx + halfW * 0.7, cy],
      [cx - halfW * 0.7, cy],
      [cx, cy + badgeH * 2.1],
      [cx, cy - badgeH * 2.1],
    ];

    let bestScore = Infinity;
    let chosenPos = [cx, cy];

    for (const [candX, candY] of candidates) {
      let overlapScore = 0;
      for (const pb of placedBadges) {
        const dx = Math.abs(candX - pb.cx);
        const dy = Math.abs(candY - pb.cy);
        const reqX = (halfW + pb.halfW) * 0.92;
        const reqY = (halfH + pb.halfH) * 0.92;
        if (dx < reqX && dy < reqY) {
          overlapScore += (reqX - dx) * (reqY - dy);
        }
      }

      const outX = Math.max(0, (ax + 0.4) - candX) + Math.max(0, candX - (ax + aw - 0.4));
      const outY = Math.max(0, (ay + 0.4) - candY) + Math.max(0, candY - (ay + ah - 0.4));
      const outPenalty = (outX + outY) * 12;

      const distFromCenter = Math.hypot(candX - cx, candY - cy);
      const score = (overlapScore * 100) + outPenalty + distFromCenter;

      if (score < bestScore) {
        bestScore = score;
        chosenPos = [candX, candY];
        if (overlapScore === 0 && outPenalty === 0) break;
      }
    }

    placedBadges.push({
      cx: chosenPos[0],
      cy: chosenPos[1],
      halfW,
      halfH,
      id: a.id,
    });

    const relX = Math.max(6, Math.min(94, ((chosenPos[0] - ax) / aw) * 100));
    const relY = Math.max(6, Math.min(94, ((chosenPos[1] - ay) / ah) * 100));
    badgeLayouts[a.id] = { relX, relY, absX: chosenPos[0], absY: chosenPos[1] };
  }

  return { badgeLayouts, placedBadges };
}

// Test with overlapping / closely adjacent warehouse & dock
const testAssets = [
  { id: 'dock', title: 'Loading Dock', area: '1500 SQM', x: '25%', y: '34%', w: '55%', h: '4%' },
  { id: 'bldg', title: 'Building B01', area: '17600 SQM', x: '25%', y: '38%', w: '55%', h: '22%' },
];

const layoutResult = computeBadgeLayouts(testAssets);
const dockLayout = layoutResult.badgeLayouts['dock'];
const bldgLayout = layoutResult.badgeLayouts['bldg'];

console.log('Dock Badge Map Pos:', dockLayout.absX.toFixed(2), dockLayout.absY.toFixed(2));
console.log('Bldg Badge Map Pos:', bldgLayout.absX.toFixed(2), bldgLayout.absY.toFixed(2));

const dy = Math.abs(dockLayout.absY - bldgLayout.absY);
assert.ok(dy >= 4.0, `Vertical badge distance must be >= 4.0% to avoid collision (got ${dy.toFixed(2)}%)`);

console.log('ALL UNIT TESTS PASSED SUCCESSFULLY!');
