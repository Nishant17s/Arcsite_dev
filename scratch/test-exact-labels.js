const assert = require('assert');

// Test classifyLabel function
function classifyLabel(text) {
  const u = String(text || '').toUpperCase().trim();
  if (/\b(STP|SEWAGE|WTP|SUMP|TANK|WATER)\b/.test(u)) {
    return { zone_type: 'utility', icon: 'UTIL', shape: 'circle' };
  }
  if (/\b(OSR|PARK|GARDEN|LANDSCAPE|LAWN|GREEN|OS-?\d+)\b/.test(u)) {
    return { zone_type: 'landscape', icon: 'LAND', shape: 'rect' };
  }
  if (/\b(METRO|BRIDGE|FLYOVER|VIADUCT|RAIL)\b/.test(u)) {
    return { zone_type: 'transit', icon: 'METRO', shape: 'bridge' };
  }
  if (/\b(ROAD|STREET|AVENUE|HIGHWAY|LANE|DRIVEWAY|ENTRY|EXIT|PATH)\b/.test(u)) {
    return { zone_type: 'road', icon: 'ROAD', shape: 'road' };
  }
  if (/\b(SECURITY|CABIN|GATE|CHECKPOST|GUARD|RESTROOM|DOCK)\b/.test(u)) {
    return { zone_type: 'utility', icon: 'UTIL', shape: 'rect' };
  }
  if (/\b(SUB\s*STATION|TRANSFORMER|UG\s*SUMP|PUMP\s*ROOM|ELECTRICAL)\b/.test(u)) {
    return { zone_type: 'utility', icon: 'UTIL', shape: 'rect' };
  }
  if (/\b(TEMPLE|MOSQUE|CHURCH|CHAPEL|SHRINE)\b/.test(u)) {
    return { zone_type: 'civic', icon: 'CIVIC', shape: 'rect' };
  }
  if (/\b(ADMIN|SCHOOL|HOSPITAL|HOSTEL|CLINIC|CANTEEN)\b/.test(u)) {
    return { zone_type: 'building', icon: 'CIVIC', shape: 'rect' };
  }
  if (/\b(B-?\d+|WH-?\d+|BLOCK|TOWER|OFFICE|BUILDING|WING|PHASE|PARKING|WAREHOUSE|SHED|BAY|PLOT-?\d+)\b/.test(u)) {
    return { zone_type: 'building', icon: 'BLDG', shape: 'rect' };
  }
  return { zone_type: 'zone', icon: 'ZONE', shape: 'rect' };
}

// Check exact label classifications
assert.strictEqual(classifyLabel('B01').zone_type, 'building');
assert.strictEqual(classifyLabel('B02').zone_type, 'building');
assert.strictEqual(classifyLabel('B03').zone_type, 'building');
assert.strictEqual(classifyLabel('B04').zone_type, 'building');
assert.strictEqual(classifyLabel('OS-2').zone_type, 'landscape');
assert.strictEqual(classifyLabel('SECURITY CABIN').zone_type, 'utility');
assert.strictEqual(classifyLabel('SUB STATION').zone_type, 'utility');

// Test parcel synthesis with 17 closed polygons (4 real buildings, 13 unlabelled polygons)
const candidateLines = [
  { text: 'B01', area: '17600 SQM', xPct: 50, yPct: 40, claimed: false },
  { text: 'B02', area: '7552 SQM', xPct: 30, yPct: 60, claimed: false },
  { text: 'B03', area: '12915 SQM', xPct: 60, yPct: 60, claimed: false },
  { text: 'B04', area: '5362 SQM', xPct: 45, yPct: 75, claimed: false },
  { text: 'OS-2', area: '', xPct: 80, yPct: 20, claimed: false },
  { text: '12M WIDE ROAD', area: '', xPct: 50, yPct: 30, claimed: false },
  { text: '6M WIDE ROAD', area: '', xPct: 70, yPct: 60, claimed: false },
];

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

// 17 polygons: 4 real buildings + 1 OS-2 + 12 unlabelled polygons (docks, internal hatches, curbs)
const siteParcels = [
  // 4 real buildings
  { id: 'p_b01', polygon: [[20, 32], [80, 32], [80, 48], [20, 48]], bbox: { x: '20%', y: '32%', w: '60%', h: '16%' }, area: 17600 },
  { id: 'p_b02', polygon: [[18, 52], [42, 52], [42, 68], [18, 68]], bbox: { x: '18%', y: '52%', w: '24%', h: '16%' }, area: 7552 },
  { id: 'p_b03', polygon: [[48, 52], [78, 52], [78, 68], [48, 68]], bbox: { x: '48%', y: '52%', w: '30%', h: '16%' }, area: 12915 },
  { id: 'p_b04', polygon: [[38, 70], [52, 70], [52, 85], [38, 85]], bbox: { x: '38%', y: '70%', w: '14%', h: '15%' }, area: 5362 },
  // OS-2
  { id: 'p_os2', polygon: [[75, 15], [90, 15], [90, 28], [75, 28]], bbox: { x: '75%', y: '15%', w: '15%', h: '13%' }, area: 10500 },
  // 12 unlabelled polygons
  { id: 'p_dock1', polygon: [[20, 28], [80, 28], [80, 32], [20, 32]], bbox: { x: '20%', y: '28%', w: '60%', h: '4%' }, area: 1200 },
  { id: 'p_dock2', polygon: [[18, 48], [42, 48], [42, 52], [18, 52]], bbox: { x: '18%', y: '48%', w: '24%', h: '4%' }, area: 600 },
  { id: 'p_dock3', polygon: [[48, 48], [78, 48], [78, 52], [48, 52]], bbox: { x: '48%', y: '48%', w: '30%', h: '4%' }, area: 800 },
  { id: 'p_sub1', polygon: [[22, 34], [40, 34], [40, 46], [22, 46]], bbox: { x: '22%', y: '34%', w: '18%', h: '12%' }, area: 2000 },
  { id: 'p_sub2', polygon: [[42, 34], [78, 34], [78, 46], [42, 46]], bbox: { x: '42%', y: '34%', w: '36%', h: '12%' }, area: 4000 },
  { id: 'p_curb1', polygon: [[10, 10], [15, 10], [15, 20], [10, 20]], bbox: { x: '10%', y: '10%', w: '5%', h: '10%' }, area: 50 },
  { id: 'p_curb2', polygon: [[12, 22], [16, 22], [16, 30], [12, 30]], bbox: { x: '12%', y: '22%', w: '4%', h: '8%' }, area: 30 },
  { id: 'p_curb3', polygon: [[82, 30], [86, 30], [86, 40], [82, 40]], bbox: { x: '82%', y: '30%', w: '4%', h: '10%' }, area: 40 },
  { id: 'p_curb4', polygon: [[82, 42], [88, 42], [88, 55], [82, 55]], bbox: { x: '82%', y: '42%', w: '6%', h: '13%' }, area: 70 },
  { id: 'p_curb5', polygon: [[30, 86], [60, 86], [60, 90], [30, 90]], bbox: { x: '30%', y: '86%', w: '30%', h: '4%' }, area: 120 },
  { id: 'p_curb6', polygon: [[5, 20], [8, 20], [8, 70], [5, 70]], bbox: { x: '5%', y: '20%', w: '3%', h: '50%' }, area: 150 },
  { id: 'p_curb7', polygon: [[14, 75], [20, 75], [20, 80], [14, 80]], bbox: { x: '14%', y: '75%', w: '6%', h: '5%' }, area: 30 },
];

// Sort parcels by area descending
siteParcels.sort((a, b) => b.area - a.area);

const extractedLabels = [];

for (const parcel of siteParcels) {
  const inside = candidateLines.filter((c) => !c.claimed && pointInPoly(c.xPct, c.yPct, parcel.polygon));
  if (inside.length === 0) continue; // SKIP unlabelled geometry!

  // Priority 1: Building / Zone code (e.g. B01, B02, B03, B04, OS-2)
  const codeCand = inside.find((c) =>
    /^(?:B-?\d+[A-Z]?|WH-?\d+[A-Z]?|PLOT-?\d+|BAY-?\d+|SHED-?\d+|TOWER\s*[A-Z0-9]+|BLOCK\s*[A-Z0-9]+|OS-?\d+)$/i.test(c.text.trim())
  );

  // Priority 2: Named architectural keywords
  const namedCand = inside.find((c) =>
    /\b(BUILDING|BLOCK|WAREHOUSE|SHED|BAY|FACILITY|OFFICE|ADMIN|SECURITY|CABIN|GATE|STP|WTP|SUB\s*STATION|TEMPLE|CANTEEN|OSR|GREEN\s*BELT|PARK)\b/i.test(c.text) &&
    !/\b(DOCK|ROAD|RESTROOM|CANOPY|RAMP)\b/i.test(c.text)
  );

  // Priority 3: General descriptive text
  const generalCand = inside.find((c) => {
    const t = c.text.trim();
    if (t.length < 2) return false;
    if (/^(?:DOCK|CANOPY|RAMP|SHUTTER|ROAD)$/i.test(t)) return false;
    return !/^\d+$/.test(t.replace(/\D/g, ''));
  });

  const matched = codeCand || namedCand || generalCand;
  if (!matched) continue; // If no valid label matched, SKIP!

  const title = matched.text.trim(); // EXACT label from drawing! NO 'Building ' prefix!
  const area = matched.area || (inside.find((c) => c.area)?.area || '');

  inside.forEach((c) => { c.claimed = true; });

  const cls = classifyLabel(title);
  extractedLabels.push({
    title,
    area,
    zone_type: cls.zone_type,
    icon: cls.icon,
    parcelId: parcel.id,
  });
}

console.log('Extracted Labels count:', extractedLabels.length);
console.log('Extracted Labels:', extractedLabels);

// Assert exactly 4 buildings
const buildings = extractedLabels.filter((l) => l.zone_type === 'building');
assert.strictEqual(buildings.length, 4, `Must have exactly 4 buildings, got ${buildings.length}`);
assert.deepStrictEqual(buildings.map(b => b.title), ['B01', 'B03', 'OS-2', 'B02', 'B04'].filter(x => x !== 'OS-2'));

// Assert exact labels
assert.strictEqual(extractedLabels.find(l => l.title === 'B01').area, '17600 SQM');
assert.strictEqual(extractedLabels.find(l => l.title === 'B02').area, '7552 SQM');
assert.strictEqual(extractedLabels.find(l => l.title === 'B03').area, '12915 SQM');
assert.strictEqual(extractedLabels.find(l => l.title === 'B04').area, '5362 SQM');

// Assert OS-2 is landscape
const landscape = extractedLabels.filter((l) => l.zone_type === 'landscape');
assert.strictEqual(landscape.length, 1);
assert.strictEqual(landscape[0].title, 'OS-2');

console.log('ALL EXACT LABEL TESTS PASSED PERFECTLY!');

