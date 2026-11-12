/* ==========================================================================
   ArcSite Studio — Native Vector PDF Extractor & SlimSAM Mask Vectorizer
   1. PDF Text Labels, Areas (SQM/Acres) & Smart File Matching
   2. Native Vector PDF Closed Polygons & Planar CAD Segment Faces (pdf.js OPS)
   3. Clean Mask-to-Polygon Contour Vectorizer for In-Browser SlimSAM (WebGPU)
   ========================================================================== */

(function () {
  'use strict';

  const NOISE_ONLY_RE = /^[\d.,+\-*/°'"()[\]\s:;%=#_]+$/;
  const AREA_RE = /(\d[\d,.]*\s*(?:SQ\.?\s*M|SQM|M2|SQ\.?\s*FT|SQFT|ACRES?|HECTARES?|HA)\b)/i;
  const NOISE_TERMS_RE = /\b(HIRANANDANI|INDUSTRIAL\s*PARKS|GROUND\s*COVERAGE|TOTAL\s*PLOT\s*AREA|OVERALL\s*SITE\s*AREA|DEVELOPMENT\s*DETAILS|LAND\s*BREAKUP|OPTION\s*[-0-9]+|REVISION|SCALE\s*1\s*:|SHEET\s*\d+|DRAWING\s*NO|AS\s*PER\s*THE\s*PLINE|PATRA|PLINE|\bLINE\b|ALL\s*DIMENSIONS|DO\s*NOT\s*SCALE|PARTICULARS|DESCRIPTION|PERCENTAGE|S\.?NO\.?|NORTH|LEGEND|CLIENT|ARCHITECT|CONSULTANT|APPROVED|CHECKED|DRAWN)\b/i;
  const ROAD_DIM_RE = /\b(?:\d+(\.\d+)?\s*M(?:TR)?\s*(?:WIDE)?\s*ROAD|\d+(\.\d+)?\s*M(?:TR)?\s*WIDE|WIDE\s*ROAD|INTERNAL\s*ROAD|ROAD\s*WIDTH|\d+\.?\d*\s*M\s*WIDE)\b/i;
  const MATH_EQ_RE = /=|\b\d+[\d,.]*\s*=\s*[\d,.]*%|\b\d+[\d,.]*%\b/i;
  const STOPWORDS_RE = /^(?:AS|PER|THE|OF|AND|BY|FOR|IN|AT|TO|FROM|WITH|ON|A|AN|IS|ARE|LINE|PLINE|PATRA|OPTION|REV|REVISION|NO|GROUND|COVERAGE|SQMT|SQM|SQFT|ACRE|ACRES|PERCENT|POR|DETAILS)$/i;

  function classifyLabel(text) {
    const u = text.toUpperCase();
    if (/\b(STP|SEWAGE|WTP|SUMP|TANK|WATER)\b/.test(u)) {
      return { zone_type: 'utility', icon: 'UTIL', shape: 'circle' };
    }
    if (/\b(OSR|PARK|GARDEN|LANDSCAPE|LAWN|GREEN)\b/.test(u)) {
      return { zone_type: 'landscape', icon: 'LAND', shape: 'rect' };
    }
    if (/\b(METRO|BRIDGE|FLYOVER|VIADUCT|RAIL)\b/.test(u)) {
      return { zone_type: 'transit', icon: 'METRO', shape: 'bridge' };
    }
    if (/\b(ROAD|STREET|AVENUE|HIGHWAY|LANE|DRIVEWAY|ENTRY|EXIT|PATH)\b/.test(u)) {
      return { zone_type: 'road', icon: 'ROAD', shape: 'road' };
    }
    if (/\b(SECURITY|CABIN|GATE|CHECKPOST|GUARD)\b/.test(u)) {
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
    if (/\b(B\d+|BLOCK|TOWER|OFFICE|BUILDING|WING|PHASE|PARKING|WAREHOUSE|SHED|BAY)\b/.test(u)) {
      return { zone_type: 'building', icon: 'BLDG', shape: 'rect' };
    }
    return { zone_type: 'zone', icon: 'ZONE', shape: 'rect' };
  }

  function isDimensionNumber(str) {
    const t = str.trim();
    if (!t || t.length < 2) return true;
    if (AREA_RE.test(t)) return false;
    return NOISE_ONLY_RE.test(t);
  }

  function isArchitecturalKeyword(text) {
    const u = String(text || '').trim().toUpperCase();
    if (/\b\d+(\.\d+)?\s*M\b/.test(u)) return false;
    if (/^(?:ROAD|WIDE\s*ROAD|INTERNAL\s*ROAD|DOCK|CANOPY|RAMP)$/i.test(u)) return false;
    return /\b(BUILDING|BLOCK|TOWER|WAREHOUSE|SHED|BAY|SECURITY|CABIN|GATE|SUB\s*STATION|TRANSFORMER|UG\s*SUMP|PUMP\s*ROOM|STP|WTP|OSR|GREEN\s*BELT|LANDSCAPE|PARKING|ENTRY|EXIT|WEIGH\s*BRIDGE|CANTEEN|ADMIN|OFFICE|TEMPLE|MOSQUE|METRO|BRIDGE)\b/.test(u);
  }

  function isMasterplanNoise(text, xPct, yPct, siteRoi) {
    const t = String(text || '').trim();
    if (t.length <= 1) return true;
    if (NOISE_ONLY_RE.test(t)) return true;
    if (/^[=\d.,+\-*/°'"()[\]\s:;%#_]+$/.test(t)) return true;
    if (MATH_EQ_RE.test(t)) return true;
    if (STOPWORDS_RE.test(t)) return true;
    if (NOISE_TERMS_RE.test(t)) return true;
    if (ROAD_DIM_RE.test(t)) return true;
    if (/\b(PLINE|PATRA|LINE|SQMT|SQM|SQFT|ACRES?|HECTARES?|GROUND|COVERAGE|OPTION|REV|REVISION|SHEET|DRAWING|SCALE|PERCENTAGE)\b/i.test(t)) {
      const stripped = t
        .replace(/\b(PLINE|PATRA|LINE|SQMT|SQM|SQFT|ACRES?|HECTARES?|GROUND|COVERAGE|OPTION|REV|REVISION|SHEET|DRAWING|SCALE|PERCENTAGE|\d+[\d,.]*)\b/gi, '')
        .replace(/[=\-[\]():;,.]/g, '')
        .trim();
      if (stripped.length < 3) return true;
    }
    if (siteRoi && (yPct < siteRoi.minY || yPct > siteRoi.maxY || xPct < siteRoi.minX || xPct > siteRoi.maxX)) {
      return true;
    }
    return false;
  }

  function parseColorRGB(args) {
    if (!Array.isArray(args) || args.length === 0) return null;
    let r = 0, g = 0, b = 0;
    if (args.length >= 3 && typeof args[0] === 'number') {
      const div = Math.max(args[0], args[1], args[2]) > 1 ? 255 : 1;
      r = Math.max(0, Math.min(1, args[0] / div));
      g = Math.max(0, Math.min(1, args[1] / div));
      b = Math.max(0, Math.min(1, args[2] / div));
    } else if (args.length === 1 && typeof args[0] === 'number') {
      const v = args[0] > 1 ? args[0] / 255 : args[0];
      r = g = b = Math.max(0, Math.min(1, v));
    } else if (typeof args[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0])) {
      r = parseInt(args[0].slice(1, 3), 16) / 255;
      g = parseInt(args[0].slice(3, 5), 16) / 255;
      b = parseInt(args[0].slice(5, 7), 16) / 255;
    } else {
      return null;
    }

    let category = 'unknown';
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const delta = maxC - minC;

    if (delta < 0.08) {
      if (maxC > 0.88) category = 'white';
      else if (maxC < 0.2) category = 'black';
      else category = 'road';
    } else if (r > 0.65 && g > 0.45 && b < 0.65 && (r - b) > 0.12) {
      // Yellow, amber, gold, orange, terracotta building roofs & pads
      category = 'building';
    } else if (g > 0.40 && g > r + 0.05 && g > b + 0.05) {
      // Green landscape, lawns, parks, OSR
      category = 'landscape';
    } else if (b > 0.50 && b > r + 0.10 && (g > 0.35 || b > g)) {
      // Blue/cyan water bodies, STP, WTP, sumps
      category = 'utility';
    } else if (r > 0.50 && b > 0.40 && g < 0.45) {
      // Magenta/pink boundary / setbacks
      category = 'boundary';
    }

    const hex = '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    return { r, g, b, hex, category };
  }

  function computeSiteRoi(closedPolys) {
    if (!Array.isArray(closedPolys) || closedPolys.length === 0) {
      return { minX: 5, minY: 16, maxX: 95, maxY: 82 };
    }
    const siteParcels = closedPolys.filter(p => p.category === 'building' || p.category === 'landscape');
    if (siteParcels.length === 0) {
      return { minX: 5, minY: 16, maxX: 95, maxY: 82 };
    }
    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    for (const p of siteParcels) {
      for (const [x, y] of p.polygon) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    return {
      minX: Math.max(0, Math.round(minX - 8)),
      minY: Math.max(14, Math.round(minY - 6)),
      maxX: Math.min(100, Math.round(maxX + 8)),
      maxY: Math.min(84, Math.round(maxY + 6)),
    };
  }

  /* ========================================================================
     Shape-Preserving Building & Parcel Consolidator
     - Merges complementary triangulated quads into full 4-corner rectangles
     - NEVER leaves warehouse bays cut in half diagonally as triangles
     - Deduplicates overlapping identical fills & strokes (IoU > 0.80)
     - Preserves exact multi-vertex L-shapes, stepped footprints, angled bays
     - Keeps separate buildings across roads and setbacks distinct
     ======================================================================== */
  function clusterBuildingPolys(polys) {
    if (!Array.isArray(polys) || polys.length <= 1) return polys || [];

    const buildings = polys.filter((p) => p.category === 'building');
    const others = polys.filter((p) => p.category !== 'building');

    const bboxIoU = (b1, b2) => {
      const bx1 = parseFloat(b1.bbox?.x || b1.x);
      const by1 = parseFloat(b1.bbox?.y || b1.y);
      const bw1 = parseFloat(b1.bbox?.w || b1.w);
      const bh1 = parseFloat(b1.bbox?.h || b1.h);
      const bx2 = parseFloat(b2.bbox?.x || b2.x);
      const by2 = parseFloat(b2.bbox?.y || b2.y);
      const bw2 = parseFloat(b2.bbox?.w || b2.w);
      const bh2 = parseFloat(b2.bbox?.h || b2.h);

      const x1 = Math.max(bx1, bx2);
      const y1 = Math.max(by1, by2);
      const x2 = Math.min(bx1 + bw1, bx2 + bw2);
      const y2 = Math.min(by1 + bh1, by2 + bh2);
      const interW = Math.max(0, x2 - x1);
      const interH = Math.max(0, y2 - y1);
      const interArea = interW * interH;
      const area1 = bw1 * bh1;
      const area2 = bw2 * bh2;
      const unionArea = area1 + area2 - interArea;
      return unionArea > 0 ? interArea / unionArea : 0;
    };

    // 1. Merge complementary triangulated quads (where 2 or more triangles share a bounding box)
    const afterTriMerge = [];
    const usedTriangles = new Set();

    for (let i = 0; i < buildings.length; i++) {
      if (usedTriangles.has(i)) continue;
      const b1 = buildings[i];

      if (b1.polygon && b1.polygon.length === 3) {
        const partners = [];
        for (let j = i + 1; j < buildings.length; j++) {
          if (usedTriangles.has(j)) continue;
          const b2 = buildings[j];
          if (b2.polygon && b2.polygon.length === 3 && bboxIoU(b1, b2) > 0.70) {
            partners.push(j);
          }
        }

        if (partners.length > 0) {
          usedTriangles.add(i);
          partners.forEach((pIdx) => usedTriangles.add(pIdx));

          const allB = [b1, ...partners.map((pIdx) => buildings[pIdx])];
          let minX = 100, minY = 100, maxX = 0, maxY = 0;
          for (const b of allB) {
            const bx = parseFloat(b.bbox.x);
            const by = parseFloat(b.bbox.y);
            const bw = parseFloat(b.bbox.w);
            const bh = parseFloat(b.bbox.h);
            if (bx < minX) minX = bx;
            if (by < minY) minY = by;
            if (bx + bw > maxX) maxX = bx + bw;
            if (by + bh > maxY) maxY = by + bh;
          }

          minX = Math.round(minX * 100) / 100;
          minY = Math.round(minY * 100) / 100;
          maxX = Math.round(maxX * 100) / 100;
          maxY = Math.round(maxY * 100) / 100;

          const rectPoly = [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
          ];

          const totalArea = allB.reduce((sum, b) => sum + (b.area || 0), 0);

          afterTriMerge.push({
            polygon: rectPoly,
            bbox: {
              x: minX.toFixed(1) + '%',
              y: minY.toFixed(1) + '%',
              w: Math.max(2.5, maxX - minX).toFixed(1) + '%',
              h: Math.max(2.5, maxY - minY).toFixed(1) + '%',
            },
            area: Math.max(totalArea, (maxX - minX) * (maxY - minY)),
            solidity: 1.0,
            category: 'building',
            fillColor: b1.fillColor || allB.find((b) => b.fillColor)?.fillColor || null,
            source: 'vector-pdf',
          });
          continue;
        } else if (b1.solidity < 0.65 && b1.area > 20) {
          // Single right triangle representing a warehouse bay: expand to full 4-corner rectangle
          usedTriangles.add(i);
          const bx = parseFloat(b1.bbox.x);
          const by = parseFloat(b1.bbox.y);
          const bw = parseFloat(b1.bbox.w);
          const bh = parseFloat(b1.bbox.h);
          const minX = Math.round(bx * 100) / 100;
          const minY = Math.round(by * 100) / 100;
          const maxX = Math.round((bx + bw) * 100) / 100;
          const maxY = Math.round((by + bh) * 100) / 100;

          const rectPoly = [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
          ];

          afterTriMerge.push({
            polygon: rectPoly,
            bbox: {
              x: minX.toFixed(1) + '%',
              y: minY.toFixed(1) + '%',
              w: Math.max(2.5, maxX - minX).toFixed(1) + '%',
              h: Math.max(2.5, maxY - minY).toFixed(1) + '%',
            },
            area: (maxX - minX) * (maxY - minY),
            solidity: 1.0,
            category: 'building',
            fillColor: b1.fillColor || null,
            source: 'vector-pdf',
          });
          continue;
        }
      }

      usedTriangles.add(i);
      afterTriMerge.push(b1);
    }

    const isContained = (pSmall, pLarge) => {
      if (pSmall.area >= pLarge.area * 0.85) return false;
      const bS = pSmall.bbox;
      const bL = pLarge.bbox;
      const sMinX = parseFloat(bS.x);
      const sMinY = parseFloat(bS.y);
      const sMaxX = sMinX + parseFloat(bS.w);
      const sMaxY = sMinY + parseFloat(bS.h);
      const lMinX = parseFloat(bL.x) - 0.4;
      const lMinY = parseFloat(bL.y) - 0.4;
      const lMaxX = lMinX + parseFloat(bL.w) + 0.8;
      const lMaxY = lMinY + parseFloat(bL.h) + 0.8;
      return sMinX >= lMinX && sMaxX <= lMaxX && sMinY >= lMinY && sMaxY <= lMaxY;
    };

    // 2. Deduplicate near-identical polygons (fill + stroke pairs)
    const dedupedBuildings = [];
    for (const b of afterTriMerge) {
      const dupeIdx = dedupedBuildings.findIndex((existing) => bboxIoU(existing, b) > 0.80);
      if (dupeIdx >= 0) {
        const existing = dedupedBuildings[dupeIdx];
        if ((b.polygon?.length || 0) > (existing.polygon?.length || 0) || (b.fillColor && !existing.fillColor)) {
          dedupedBuildings[dupeIdx] = b;
        }
      } else {
        dedupedBuildings.push(b);
      }
    }

    // 3. Remove interior sub-patches (skylights, internal hatch quads)
    const filteredBuildings = dedupedBuildings.filter((b, idx) => {
      for (let j = 0; j < dedupedBuildings.length; j++) {
        if (idx === j) continue;
        if (isContained(b, dedupedBuildings[j])) return false;
      }
      return true;
    });

    // ALWAYS return exact polygon vertices — NEVER replace L-shapes or multi-vertex complexes!
    return [...filteredBuildings, ...others];
  }

  /* ========================================================================
     Tier 1: Native Vector PDF Path & Closed Polyline Extractor (pdf.js OPS)
     ======================================================================== */

  function polygonAreaPct(pts) {
    if (!Array.isArray(pts) || pts.length < 3) return 0;
    let sum = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      sum += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    }
    return Math.abs(sum) / 2;
  }

  function polygonPerimPct(pts) {
    let p = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      p += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return p;
  }

  function cleanPolyPct(pts, closeDist = 0.35) {
    const out = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= 0.08) {
        out.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
      }
    }
    if (out.length >= 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= closeDist) {
      out.pop();
    }
    return out;
  }

  function bboxFromPolyPct(polygon) {
    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    for (const [xp, yp] of polygon) {
      if (xp < minX) minX = xp;
      if (yp < minY) minY = yp;
      if (xp > maxX) maxX = xp;
      if (yp > maxY) maxY = yp;
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      wNum: Math.max(0.5, maxX - minX),
      hNum: Math.max(0.5, maxY - minY),
      bbox: {
        x: minX.toFixed(1) + '%',
        y: minY.toFixed(1) + '%',
        w: Math.max(2.5, maxX - minX).toFixed(1) + '%',
        h: Math.max(2.5, maxY - minY).toFixed(1) + '%',
      },
    };
  }

  function parsePdfGrayHatchFlag(args, defaultGray = false) {
    if (!Array.isArray(args) || args.length === 0) return defaultGray;
    const first = args[0];
    if (typeof first === 'string' && /^#[0-9a-f]{6}$/i.test(first)) {
      const r = parseInt(first.slice(1, 3), 16) / 255;
      const g = parseInt(first.slice(3, 5), 16) / 255;
      const b = parseInt(first.slice(5, 7), 16) / 255;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      return maxC - minC < 0.08 && maxC > 0.3 && maxC < 0.92;
    }
    if (args.length >= 3 && typeof args[0] === 'number') {
      const div = Math.max(args[0], args[1], args[2]) > 1 ? 255 : 1;
      const r = args[0] / div;
      const g = args[1] / div;
      const b = args[2] / div;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      return maxC - minC < 0.08 && maxC > 0.3 && maxC < 0.92;
    }
    if (args.length === 1 && typeof first === 'number') {
      const v = first > 1 ? first / 255 : first;
      return v > 0.3 && v < 0.92;
    }
    return defaultGray;
  }

  function buildPlanarFaceFinder(rawSegments) {
    if (!rawSegments || rawSegments.length < 3 || rawSegments.length > 6000) return null;

    // 1. Cluster endpoints FIRST (radius = 0.6%) onto fixed vertices so graph stays planar after splitting
    const clusterNodes = [];
    const snapClusterPt = (pt) => {
      for (const nd of clusterNodes) {
        if (Math.hypot(pt[0] - nd.x, pt[1] - nd.y) <= 0.6) return [nd.x, nd.y];
      }
      const copy = { x: pt[0], y: pt[1] };
      clusterNodes.push(copy);
      return [copy.x, copy.y];
    };

    const deduped = [];
    for (const [ra, rb] of rawSegments) {
      const a = snapClusterPt(ra);
      const b = snapClusterPt(rb);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.25) continue;
      const same = deduped.some(([c, d]) =>
        (Math.hypot(a[0] - c[0], a[1] - c[1]) < 0.1 && Math.hypot(b[0] - d[0], b[1] - d[1]) < 0.1) ||
        (Math.hypot(a[0] - d[0], a[1] - d[1]) < 0.1 && Math.hypot(b[0] - c[0], b[1] - c[1]) < 0.1)
      );
      if (!same) deduped.push([a, b]);
    }
    if (deduped.length < 3) return null;

    // 2. Split crossing edges & T-junctions on fixed cluster coordinates
    const splitPts = deduped.map(() => [0, 1]);
    for (let i = 0; i < deduped.length; i++) {
      const [a, b] = deduped[i];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      if (abx * abx + aby * aby < 1e-6) continue;
      for (let j = i + 1; j < deduped.length; j++) {
        const [c, d] = deduped[j];
        const cdx = d[0] - c[0];
        const cdy = d[1] - c[1];
        const den = abx * cdy - aby * cdx;
        if (Math.abs(den) > 1e-6) {
          const acx = c[0] - a[0];
          const acy = c[1] - a[1];
          const t = (acx * cdy - acy * cdx) / den;
          const u = (acx * aby - acy * abx) / den;
          if (t >= -0.02 && t <= 1.02 && u >= -0.02 && u <= 1.02) {
            if (t > 0.02 && t < 0.98) splitPts[i].push(t);
            if (u > 0.02 && u < 0.98) splitPts[j].push(u);
          }
        }
        const tjChecks = [[i, c, a, b], [i, d, a, b], [j, a, c, d], [j, b, c, d]];
        for (const [segIdx, pt, s0, s1] of tjChecks) {
          const vx = s1[0] - s0[0];
          const vy = s1[1] - s0[1];
          const lenSq = vx * vx + vy * vy;
          if (lenSq < 1e-6) continue;
          const t = ((pt[0] - s0[0]) * vx + (pt[1] - s0[1]) * vy) / lenSq;
          if (t > 0.02 && t < 0.98) {
            const px = s0[0] + t * vx;
            const py = s0[1] + t * vy;
            if (Math.hypot(pt[0] - px, pt[1] - py) < 0.4) splitPts[segIdx].push(t);
          }
        }
      }
    }

    const splitSegs = [];
    for (let i = 0; i < deduped.length; i++) {
      const [a, b] = deduped[i];
      const ts = splitPts[i].slice().sort((x, y) => x - y);
      const uniq = [ts[0]];
      for (const t of ts) {
        if (t - uniq[uniq.length - 1] > 0.015) uniq.push(t);
      }
      if (uniq[uniq.length - 1] < 0.99) uniq[uniq.length - 1] = 1;
      for (let k = 0; k < uniq.length - 1; k++) {
        const t0 = uniq[k];
        const t1 = uniq[k + 1];
        const p0 = [a[0] + t0 * (b[0] - a[0]), a[1] + t0 * (b[1] - a[1])];
        const p1 = [a[0] + t1 * (b[0] - a[0]), a[1] + t1 * (b[1] - a[1])];
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) >= 0.25) splitSegs.push([p0, p1]);
      }
    }

    // 3. Build planar graph on fixed intersection points & prune degree <= 1 CAD stubs (2-core)
    const nodes = [];
    const getNode = (pt) => {
      for (const nd of nodes) {
        if (Math.hypot(pt[0] - nd.x, pt[1] - nd.y) <= 0.25) return nd;
      }
      const nd = { key: nodes.length, x: pt[0], y: pt[1], neighbors: [] };
      nodes.push(nd);
      return nd;
    };

    const edgeSet = new Set();
    const edges = [];
    for (const [a, b] of splitSegs) {
      const na = getNode(a);
      const nb = getNode(b);
      if (na.key === nb.key) continue;
      const eKey = na.key < nb.key ? `${na.key}|${nb.key}` : `${nb.key}|${na.key}`;
      if (edgeSet.has(eKey)) continue;
      edgeSet.add(eKey);
      edges.push([na, nb]);
    }
    if (edges.length < 3) return null;

    for (const [na, nb] of edges) {
      na.neighbors.push(nb);
      nb.neighbors.push(na);
    }

    let pruned = true;
    while (pruned) {
      pruned = false;
      for (const nd of nodes) {
        if (nd.neighbors.length === 1) {
          const other = nd.neighbors[0];
          nd.neighbors = [];
          other.neighbors = other.neighbors.filter((x) => x !== nd);
          pruned = true;
        }
      }
    }

    const activeEdges = edges.filter(([na, nb]) => na.neighbors.includes(nb) && nb.neighbors.includes(na));
    if (activeEdges.length < 3) return null;
    for (const nd of nodes) {
      nd.neighbors.sort((u, v) => Math.atan2(u.y - nd.y, u.x - nd.x) - Math.atan2(v.y - nd.y, v.x - nd.x));
    }

    return function traceFaceAt(xPct, yPct) {
      // Cast 4 cardinal rays from (xPct, yPct) so thin double-rails on one side never block enclosed faces
      const hits = [];
      for (const [na, nb] of activeEdges) {
        if ((na.y > yPct) !== (nb.y > yPct)) {
          const ix = na.x + ((yPct - na.y) * (nb.x - na.x)) / (nb.y - na.y);
          if (ix > xPct) hits.push({ dist: ix - xPct, u: na.y < nb.y ? nb : na, v: na.y < nb.y ? na : nb });
          else hits.push({ dist: xPct - ix, u: na.y < nb.y ? na : nb, v: na.y < nb.y ? nb : na });
        }
        if ((na.x > xPct) !== (nb.x > xPct)) {
          const iy = na.y + ((xPct - na.x) * (nb.y - na.y)) / (nb.x - na.x);
          if (iy > yPct) hits.push({ dist: iy - yPct, u: na.x < nb.x ? na : nb, v: na.x < nb.x ? nb : na });
          else hits.push({ dist: yPct - iy, u: na.x < nb.x ? nb : na, v: na.x < nb.x ? na : nb });
        }
      }
      hits.sort((a, b) => a.dist - b.dist);

      const candidates = [];
      for (const hit of hits.slice(0, 12)) {
        const poly = [[hit.u.x, hit.u.y]];
        let prev = hit.u;
        let curr = hit.v;
        let closed = false;
        for (let step = 0; step < 120; step++) {
          poly.push([Math.round(curr.x * 100) / 100, Math.round(curr.y * 100) / 100]);
          if (curr === hit.u) {
            closed = true;
            break;
          }
          const nbList = curr.neighbors;
          if (nbList.length < 2) break;
          const backIdx = nbList.indexOf(prev);
          if (backIdx < 0) break;
          // Screen coords (y-down): tightest interior CCW loop takes next cyclic neighbor
          const next = nbList[(backIdx + 1) % nbList.length];
          prev = curr;
          curr = next;
        }
        if (!closed || poly.length < 4) continue;
        let clean = cleanPolyPct(poly, 0.25);
        if (clean.length < 3) continue;
        const area = polygonAreaPct(clean);
        if (area < 14 || area > 3500) continue;
        if (!pointInPolygon(xPct, yPct, clean)) continue;
        let eps = 0.28;
        while (clean.length > 14 && eps < 1.2) {
          const simp = douglasPeucker(clean.concat([clean[0]]), eps).slice(0, -1);
          if (simp.length >= 3) clean = simp;
          eps += 0.15;
        }
        const info = bboxFromPolyPct(clean);
        if (info.wNum > 88 && info.hNum > 88) continue;
        const solidity = area / Math.max(0.01, info.wNum * info.hNum);
        if (solidity < 0.26) continue;
        candidates.push({ polygon: clean, bbox: info.bbox, solidity, area, source: 'vector-pdf' });
      }
      candidates.sort((a, b) => a.area - b.area);
      return candidates[0] || null;
    };
  }

  async function extractPdfVectorGeometry(page, viewport, pdfjsLib) {
    try {
      const opList = await page.getOperatorList();
      const OPS = pdfjsLib.OPS || {};
      const Util = pdfjsLib.Util;
      if (!opList || !OPS || !Util) return { closedPolys: [], findFaceAt: null };

      const ctmStack = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      let strokeIsGray = false;
      let currentFillColor = { r: 0, g: 0, b: 0, hex: '#000000', category: 'unknown' };
      let currentStrokeColor = { r: 0, g: 0, b: 0, hex: '#000000', category: 'unknown' };
      const closedPolys = [];
      const primarySegs = [];
      const allSegs = [];
      let pendingBatch = [];

      const toPct = (px, py) => {
        const [tx, ty] = Util.applyTransform([px, py], ctm);
        const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
        return [(vx / viewport.width) * 100, (vy / viewport.height) * 100];
      };

      const recordSubpath = (pts, closed, isGray, fillColor = null, isFill = false) => {
        if (!pts || pts.length < 2) return;
        const isClosed =
          closed ||
          (pts.length >= 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 0.4);
        const targetSegs = isGray ? allSegs : primarySegs;

        if (isClosed && pts.length >= 3) {
          let clean = cleanPolyPct(pts, 0.4);
          if (clean.length >= 3) {
            const area = polygonAreaPct(clean);
            const perim = polygonPerimPct(clean);
            // AutoCAD wide polylines exported as skinny filled triangles/quads: collapse to single centerline
            if (perim > 0 && area / perim < 0.35 && area < 8) {
              let bestD = -1, pA = clean[0], pB = clean[1];
              for (let a = 0; a < clean.length; a++) {
                for (let b = a + 1; b < clean.length; b++) {
                  const d = Math.hypot(clean[b][0] - clean[a][0], clean[b][1] - clean[a][1]);
                  if (d > bestD) { bestD = d; pA = clean[a]; pB = clean[b]; }
                }
              }
              if (bestD >= 0.25 && targetSegs.length < 6000) {
                targetSegs.push([pA, pB]);
                if (!isGray && allSegs.length < 6000) allSegs.push([pA, pB]);
              }
              return;
            }
            if (clean.length > 12) {
              const simp = douglasPeucker(clean.concat([clean[0]]), 0.25).slice(0, -1);
              if (simp.length >= 3) clean = simp;
            }
            const info = bboxFromPolyPct(clean);
            const isColoredParcel = isFill && fillColor && (fillColor.category === 'building' || fillColor.category === 'landscape' || fillColor.category === 'road');
            const validBounds = !(info.wNum > 88 && info.hNum > 88) && clean.every(([x, y]) => x >= -2 && x <= 102 && y >= -2 && y <= 102);

            if (validBounds && area >= 6 && area <= 4200) {
              const solidity = area / Math.max(0.01, info.wNum * info.hNum);
              if (isColoredParcel || (!isGray && solidity >= 0.26)) {
                closedPolys.push({
                  polygon: clean,
                  bbox: info.bbox,
                  area,
                  solidity,
                  category: isColoredParcel ? fillColor.category : 'building',
                  fillColor: isColoredParcel ? fillColor.hex : null,
                  source: 'vector-pdf',
                });
              }
            }
          }
        }

        const simplified = !isClosed && pts.length > 2 ? douglasPeucker(pts, 0.15) : pts;
        for (let k = 0; k < simplified.length - 1 && targetSegs.length < 6000; k++) {
          const a = simplified[k];
          const b = simplified[k + 1];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.2) {
            targetSegs.push([a, b]);
            if (!isGray && allSegs.length < 6000) allSegs.push([a, b]);
          }
        }
        if (isClosed && simplified.length >= 3 && targetSegs.length < 6000) {
          const a = simplified[simplified.length - 1];
          const b = simplified[0];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.2) {
            targetSegs.push([a, b]);
            if (!isGray && allSegs.length < 6000) allSegs.push([a, b]);
          }
        }
      };

      const flushPendingBatch = (forceClose = false, isFill = false) => {
        for (const item of pendingBatch) {
          recordSubpath(item.pts, item.closed || forceClose, item.isGray, item.fillColor, isFill);
        }
        pendingBatch = [];
      };

      const collectOps = (subOps, coords) => {
        if (!subOps || !coords) return;
        let c = 0;
        let cur = [];
        let curClosed = false;
        const pushCur = () => {
          if (cur.length >= 2) pendingBatch.push({ pts: cur, closed: curClosed, isGray: strokeIsGray, fillColor: currentFillColor });
          cur = [];
          curClosed = false;
        };

        for (let j = 0; j < subOps.length; j++) {
          const sop = subOps[j];
          if (sop === OPS.moveTo && c + 1 < coords.length) {
            pushCur();
            cur.push(toPct(coords[c], coords[c + 1]));
            c += 2;
          } else if (sop === OPS.lineTo && c + 1 < coords.length) {
            cur.push(toPct(coords[c], coords[c + 1]));
            c += 2;
          } else if (sop === OPS.curveTo && c + 5 < coords.length) {
            const p0 = cur.length ? cur[cur.length - 1] : toPct(coords[c], coords[c + 1]);
            const p1 = toPct(coords[c], coords[c + 1]);
            const p2 = toPct(coords[c + 2], coords[c + 3]);
            const p3 = toPct(coords[c + 4], coords[c + 5]);
            const mid = [
              0.125 * p0[0] + 0.375 * p1[0] + 0.375 * p2[0] + 0.125 * p3[0],
              0.125 * p0[1] + 0.375 * p1[1] + 0.375 * p2[1] + 0.125 * p3[1],
            ];
            cur.push(mid, p3);
            c += 6;
          } else if ((sop === OPS.curveTo2 || sop === OPS.curveTo3) && c + 3 < coords.length) {
            cur.push(toPct(coords[c + 2], coords[c + 3]));
            c += 4;
          } else if (sop === OPS.closePath) {
            curClosed = true;
            pushCur();
          } else if (sop === OPS.rectangle && c + 3 < coords.length) {
            pushCur();
            const rx = coords[c], ry = coords[c + 1], rw = coords[c + 2], rh = coords[c + 3];
            c += 4;
            if (Math.abs(rw) > 0 && Math.abs(rh) > 0) {
              pendingBatch.push({
                pts: [toPct(rx, ry), toPct(rx + rw, ry), toPct(rx + rw, ry + rh), toPct(rx, ry + rh)],
                closed: true,
                isGray: strokeIsGray,
                fillColor: currentFillColor,
              });
            }
          }
        }
        pushCur();
      };

      const fnArr = opList.fnArray || [];
      const argsArr = opList.argsArray || [];
      let standaloneCur = [];
      let standaloneClosed = false;

      for (let i = 0; i < fnArr.length; i++) {
        const fn = fnArr[i];
        const args = argsArr[i];
        if (fn === OPS.save) {
          ctmStack.push({
            ctm: ctm.slice(),
            gray: strokeIsGray,
            fillColor: { ...currentFillColor },
            strokeColor: { ...currentStrokeColor },
          });
        } else if (fn === OPS.restore) {
          if (ctmStack.length) {
            const st = ctmStack.pop();
            ctm = st.ctm;
            strokeIsGray = st.gray;
            if (st.fillColor) currentFillColor = st.fillColor;
            if (st.strokeColor) currentStrokeColor = st.strokeColor;
          }
        } else if (fn === OPS.transform && Array.isArray(args)) {
          ctm = Util.transform(ctm, args);
        } else if (fn === OPS.paintFormXObjectBegin) {
          ctmStack.push({
            ctm: ctm.slice(),
            gray: strokeIsGray,
            fillColor: { ...currentFillColor },
            strokeColor: { ...currentStrokeColor },
          });
          if (args && Array.isArray(args[0])) ctm = Util.transform(ctm, args[0]);
        } else if (fn === OPS.paintFormXObjectEnd) {
          if (ctmStack.length) {
            const st = ctmStack.pop();
            ctm = st.ctm;
            strokeIsGray = st.gray;
            if (st.fillColor) currentFillColor = st.fillColor;
            if (st.strokeColor) currentStrokeColor = st.strokeColor;
          }
        } else if (fn === OPS.setFillRGBColor) {
          const pc = parseColorRGB(args);
          if (pc) currentFillColor = pc;
        } else if (fn === OPS.setFillGray) {
          const pc = parseColorRGB([args[0], args[0], args[0]]);
          if (pc) currentFillColor = pc;
        } else if (fn === OPS.setStrokeRGBColor) {
          const pc = parseColorRGB(args);
          if (pc) currentStrokeColor = pc;
          strokeIsGray = parsePdfGrayHatchFlag(args, strokeIsGray);
        } else if (fn === OPS.setStrokeGray) {
          const pc = parseColorRGB([args[0], args[0], args[0]]);
          if (pc) currentStrokeColor = pc;
          strokeIsGray = parsePdfGrayHatchFlag(args, strokeIsGray);
        } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 2) {
          flushPendingBatch(false, false);
          collectOps(args[0], args[1]);
        } else if (fn === OPS.clip || fn === OPS.eoClip || fn === OPS.endPath) {
          // Clipping paths (`W n`) are not painted borders — discard pendingBatch cleanly
          pendingBatch = [];
          standaloneCur = [];
          standaloneClosed = false;
        } else if (
          fn === OPS.stroke ||
          fn === OPS.closeStroke ||
          fn === OPS.fill ||
          fn === OPS.eoFill ||
          fn === OPS.fillStroke ||
          fn === OPS.eoFillStroke ||
          fn === OPS.closeFillStroke ||
          fn === OPS.closeEOFillStroke
        ) {
          const isFill =
            fn === OPS.fill ||
            fn === OPS.eoFill ||
            fn === OPS.fillStroke ||
            fn === OPS.eoFillStroke ||
            fn === OPS.closeFillStroke ||
            fn === OPS.closeEOFillStroke;
          const closedOp = isFill || fn === OPS.closeStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
          flushPendingBatch(closedOp, isFill);
          if (standaloneCur.length >= 2) {
            recordSubpath(standaloneCur, standaloneClosed || closedOp, strokeIsGray, currentFillColor, isFill);
          }
          standaloneCur = [];
          standaloneClosed = false;
        } else if (fn === OPS.moveTo && Array.isArray(args) && args.length >= 2) {
          if (standaloneCur.length >= 2)
            pendingBatch.push({ pts: standaloneCur, closed: standaloneClosed, isGray: strokeIsGray, fillColor: currentFillColor });
          standaloneCur = [toPct(args[0], args[1])];
          standaloneClosed = false;
        } else if (fn === OPS.lineTo && Array.isArray(args) && args.length >= 2) {
          standaloneCur.push(toPct(args[0], args[1]));
        } else if (fn === OPS.closePath) {
          standaloneClosed = true;
          if (standaloneCur.length >= 2)
            pendingBatch.push({ pts: standaloneCur, closed: true, isGray: strokeIsGray, fillColor: currentFillColor });
          standaloneCur = [];
          standaloneClosed = false;
        } else if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
          const [rx, ry, rw, rh] = args;
          if (Math.abs(rw) > 0 && Math.abs(rh) > 0) {
            pendingBatch.push({
              pts: [toPct(rx, ry), toPct(rx + rw, ry), toPct(rx + rw, ry + rh), toPct(rx, ry + rh)],
              closed: true,
              isGray: strokeIsGray,
              fillColor: currentFillColor,
            });
          }
        }
      }
      flushPendingBatch(false, false);
      if (standaloneCur.length >= 2) recordSubpath(standaloneCur, standaloneClosed, strokeIsGray, currentFillColor, false);

      const clusteredPolys = clusterBuildingPolys(closedPolys);
      clusteredPolys.sort((a, b) => a.area - b.area);
      const chosenSegs = primarySegs.length >= 6 ? primarySegs : allSegs;
      const findFaceAt = buildPlanarFaceFinder(chosenSegs);
      const siteRoi = computeSiteRoi(clusteredPolys);
      return { closedPolys: clusteredPolys, siteRoi, segmentCount: chosenSegs.length, findFaceAt };
    } catch {
      return { closedPolys: [], siteRoi: { minX: 5, minY: 16, maxX: 95, maxY: 82 }, findFaceAt: null };
    }
  }

  function findVectorPolygonAt(vectorCtx, xPct, yPct) {
    if (!vectorCtx || !Number.isFinite(xPct) || !Number.isFinite(yPct)) return null;
    if (Array.isArray(vectorCtx.closedPolys)) {
      for (const polyObj of vectorCtx.closedPolys) {
        if (pointInPolygon(xPct, yPct, polyObj.polygon)) {
          return polyObj;
        }
      }
    }
    if (typeof vectorCtx.findFaceAt === 'function') {
      return vectorCtx.findFaceAt(xPct, yPct);
    }
    return null;
  }

  async function extractPdfLabelsFromBuffer(arrayBuffer) {
    if (!window.ViewerManager) throw new Error('ViewerManager not ready');
    const pdfjsLib = await window.ViewerManager.loadPdfJs();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const [textContent, vectorGeometry] = await Promise.all([
      page.getTextContent(),
      extractPdfVectorGeometry(page, viewport, pdfjsLib),
    ]);

    const rawItems = [];
    for (const item of textContent.items || []) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const tx = item.transform ? item.transform[4] : 0;
      const ty = item.transform ? item.transform[5] : 0;
      const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
      const xPct = (vx / viewport.width) * 100;
      const yPct = (vy / viewport.height) * 100;
      if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) continue;
      if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) continue;
      const itemW = item.width ? (item.width / viewport.width) * 100 : Math.min(6, str.length * 0.4);
      rawItems.push({ str, xPct, yPct, wPct: Math.max(0.5, itemW) });
    }

    rawItems.sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
    const lines = [];
    for (const item of rawItems) {
      const prev = lines[lines.length - 1];
      if (
        prev &&
        Math.abs(prev.yPct - item.yPct) <= 0.9 &&
        item.xPct - prev.maxX <= 1.4 &&
        item.xPct >= prev.xPct - 0.5
      ) {
        prev.text = `${prev.text} ${item.str}`.replace(/\s+/g, ' ').trim();
        prev.maxX = Math.max(prev.maxX, item.xPct + item.wPct);
      } else {
        lines.push({
          text: item.str,
          xPct: item.xPct,
          maxX: item.xPct + item.wPct,
          yPct: item.yPct,
        });
      }
    }

    // 1. Extract Sheet Metadata (Site Area, Ground Coverage, Option)
    let siteAreaText = '';
    let groundCoverageText = '';
    let optionText = '';

    for (const line of lines) {
      const t = line.text.trim();
      if (/OVERALL\s*SITE\s*AREA|TOTAL\s*SITE\s*AREA/i.test(t)) {
        siteAreaText = t;
      } else if (!siteAreaText && /\[AREA\s*=\s*.*?\]/i.test(t)) {
        siteAreaText = t.replace(/[\[\]]/g, '').trim();
      } else if (!siteAreaText && /AREA\s*=\s*\d+[\d,.]*\s*ACRES?/i.test(t)) {
        siteAreaText = t;
      }
      if (/GROUND\s*COVERAGE.*?=\s*[\d,.]*%/i.test(t) || /\b\d+[\d,.]*\s*=\s*[\d,.]*%/i.test(t)) {
        if (!groundCoverageText) groundCoverageText = t;
      }
      if (/OPTION\s*[-0-9]+/i.test(t) || /MASTER\s*PLAN\s*OPTION/i.test(t)) {
        if (!optionText) optionText = t;
      }
    }

    // 2. Compute Site Plan ROI
    const siteRoi = vectorGeometry.siteRoi || computeSiteRoi(vectorGeometry.closedPolys);

    // 3. Filter valid candidate text within the site
    const candidateLines = [];
    const areaTokens = [];

    for (const line of lines) {
      const t = line.text.trim();
      if (isDimensionNumber(t)) continue;
      if (isMasterplanNoise(t, line.xPct, line.yPct, siteRoi)) continue;

      const areaMatch = t.match(AREA_RE);
      if (areaMatch && t.replace(AREA_RE, '').trim().length < 2) {
        areaTokens.push({ area: areaMatch[1].trim(), xPct: line.xPct, yPct: line.yPct });
        continue;
      }

      candidateLines.push({
        text: t,
        area: areaMatch ? areaMatch[1].trim() : '',
        xPct: (line.xPct + line.maxX) / 2,
        yPct: line.yPct,
        claimed: false,
      });
    }

    for (const tok of areaTokens) {
      let best = null;
      let bestDist = Infinity;
      for (const cand of candidateLines) {
        if (cand.area) continue;
        const dx = Math.abs(cand.xPct - tok.xPct);
        const dy = tok.yPct - cand.yPct;
        if (dx <= 5.5 && dy >= -1.5 && dy <= 4.5) {
          const d = dx + Math.abs(dy);
          if (d < bestDist) {
            bestDist = d;
            best = cand;
          }
        }
      }
      if (best) {
        best.area = tok.area;
      } else if (!siteAreaText && /ACRE|HECTARE/i.test(tok.area)) {
        siteAreaText = tok.area;
      }
    }

    // 4. Parcel-First Synthesis: match candidate lines into closed building & landscape parcels
    const labels = [];
    let bldgCounter = 1;

    const siteParcels = (vectorGeometry.closedPolys || []).filter((p) => {
      const cx = parseFloat(p.bbox.x) + parseFloat(p.bbox.w) / 2;
      const cy = parseFloat(p.bbox.y) + parseFloat(p.bbox.h) / 2;
      return cx >= siteRoi.minX - 5 && cx <= siteRoi.maxX + 5 && cy >= siteRoi.minY - 5 && cy <= siteRoi.maxY + 5;
    });

    for (const parcel of siteParcels) {
      const inside = candidateLines.filter((c) => !c.claimed && pointInPolygon(c.xPct, c.yPct, parcel.polygon));
      let title = '';
      let area = '';

      const bboxW = parseFloat(parcel.bbox.w || 0);
      const bboxH = parseFloat(parcel.bbox.h || 0);
      const isDockStrip = parcel.category === 'building' && (bboxW / Math.max(0.1, bboxH) > 4.2 || bboxH / Math.max(0.1, bboxW) > 4.2) && (parcel.area < 4000);
      const isLargeBuilding = parcel.category === 'building' && !isDockStrip && (parcel.area > 2500 || (bboxH > 6 && bboxW > 10));

      if (inside.length > 0) {
        // Priority 1: Exact Building / Warehouse Codes (e.g. "B01", "B-01", "B1", "WH-01", "PLOT 1", "BLOCK 1")
        const codeToken = inside.find((c) =>
          /^(?:B-?\d+[A-Z]?|WH-?\d+[A-Z]?|PLOT-?\d+|BAY-?\d+|SHED-?\d+|TOWER\s*[A-Z0-9]+|BLOCK\s*[A-Z0-9]+)$/i.test(c.text.trim())
        );

        // Priority 2: Primary building facility names (WAREHOUSE, FACTORY, OFFICE, ADMIN, SECURITY, SUB STATION, STP)
        const primaryBuilding = inside.find((c) =>
          /\b(BUILDING|BLOCK|WAREHOUSE|SHED|BAY|FACILITY|OFFICE|ADMIN|SECURITY|CABIN|STP|WTP|SUB\s*STATION|TEMPLE|CANTEEN)\b/i.test(c.text) &&
          !/\b(DOCK|ROAD|RESTROOM|CANOPY|RAMP)\b/i.test(c.text)
        );

        // Priority 3: General descriptive architectural text (excluding secondary dock/canopy if large building)
        const generalText = inside.find((c) => {
          const t = c.text.trim();
          if (isDimensionNumber(t) || t.length < 3) return false;
          if (isLargeBuilding && /^(?:DOCK|CANOPY|RAMP|SHUTTER)$/i.test(t)) return false;
          return !/^\d+$/.test(t.replace(/\D/g, ''));
        });

        // Priority 4: Structural attachment / dock canopy words
        const attachmentText = inside.find((c) => /\b(DOCK|CANOPY|RAMP|RESTROOM)\b/i.test(c.text));

        const matchedCand = codeToken || primaryBuilding || generalText || attachmentText;

        if (matchedCand) {
          const raw = matchedCand.text.trim();
          if (/^B-?\d+[A-Z]?$/i.test(raw)) {
            title = 'Building ' + raw.toUpperCase();
          } else if (/^WH-?\d+[A-Z]?$/i.test(raw)) {
            title = 'Warehouse ' + raw.toUpperCase();
          } else if (/^DOCK$/i.test(raw)) {
            title = isLargeBuilding ? `Building 0${bldgCounter++}` : 'Loading Dock';
          } else {
            title = raw;
          }
          area = matchedCand.area || (inside.find((c) => c.area)?.area || '');
        } else {
          title =
            isDockStrip
              ? 'Loading Dock'
              : parcel.category === 'building'
              ? `Building 0${bldgCounter++}`
              : parcel.category === 'landscape'
              ? 'OSR / Green Belt'
              : 'Zone';
          area = inside.find((c) => c.area)?.area || '';
        }

        inside.forEach((c) => {
          c.claimed = true;
        });
      } else {
        if (isDockStrip) {
          title = 'Loading Dock';
        } else if (parcel.category === 'building') {
          title = `Building 0${bldgCounter++}`;
        } else if (parcel.category === 'landscape') {
          title = 'OSR / Green Belt';
        } else if (parcel.category === 'road') {
          continue;
        } else {
          continue;
        }
      }

      const cls = classifyLabel(title);
      const cx = Math.round((parseFloat(parcel.bbox.x) + parseFloat(parcel.bbox.w) / 2) * 100) / 100;
      const cy = Math.round((parseFloat(parcel.bbox.y) + parseFloat(parcel.bbox.h) / 2) * 100) / 100;

      labels.push({
        text: title,
        area,
        zone_type: isDockStrip ? 'utility' : (parcel.category === 'building' ? 'building' : (parcel.category === 'landscape' ? 'landscape' : cls.zone_type)),
        icon: isDockStrip ? 'UTIL' : (parcel.category === 'landscape' ? 'LAND' : (cls.icon || 'BLDG')),
        shape: 'polygon',
        polygon: parcel.polygon,
        vectorPolygon: parcel.polygon,
        vectorBbox: parcel.bbox,
        vectorSource: parcel.source || 'vector-pdf',
        xPct: cx,
        yPct: cy,
        selected: true,
      });
    }

    // 5. Add remaining unclaimed candidate lines ONLY if they match architectural keywords (Gates, Utilities, Landmarks)
    for (const cand of candidateLines) {
      if (cand.claimed) continue;
      if (!isArchitecturalKeyword(cand.text)) continue;
      if (isMasterplanNoise(cand.text, cand.xPct, cand.yPct, siteRoi)) continue;

      const cls = classifyLabel(cand.text);
      labels.push({
        text: cand.text,
        area: cand.area,
        zone_type: cls.zone_type,
        icon: cls.icon || 'ZONE',
        shape: cls.shape,
        xPct: Math.round(cand.xPct * 100) / 100,
        yPct: Math.round(cand.yPct * 100) / 100,
        selected: true,
      });
    }

    return {
      siteAreaText,
      groundCoverageText,
      optionText,
      labels: labels.slice(0, 30),
      vectorGeometry,
    };
  }

  /* ========================================================================
     Contour Vectorizer for SlimSAM Binary Masks
     ======================================================================== */

  function perpDist(pt, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(pt[0] - a[0], pt[1] - a[1]);
    const t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy);
    return Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy));
  }

  function douglasPeucker(pts, epsilon) {
    if (pts.length <= 3) return pts;
    let maxDist = 0;
    let idx = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
      const d = perpDist(pts[i], pts[0], pts[end]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > epsilon) {
      const left = douglasPeucker(pts.slice(0, idx + 1), epsilon);
      const right = douglasPeucker(pts.slice(idx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[end]];
  }

  function traceMaskContour(mask, w, h, epsilonPx) {
    let startX = -1;
    let startY = -1;
    outer: for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (mask[y * w + x]) {
          startX = x;
          startY = y;
          break outer;
        }
      }
    }
    if (startX < 0) return null;

    const dirs = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    const contour = [[startX, startY]];
    let cx = startX;
    let cy = startY;
    let backDir = 6;
    const maxSteps = w * h;

    for (let step = 0; step < maxSteps; step++) {
      let found = false;
      for (let k = 0; k < 8; k++) {
        const d = (backDir + 1 + k) % 8;
        const nx = cx + dirs[d][0];
        const ny = cy + dirs[d][1];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) {
          cx = nx;
          cy = ny;
          backDir = (d + 4) % 8;
          if (cx === startX && cy === startY && contour.length > 3) {
            found = true;
            break;
          }
          contour.push([cx, cy]);
          found = true;
          break;
        }
      }
      if (!found || (cx === startX && cy === startY && contour.length > 3)) break;
    }

    if (contour.length < 8) return null;
    let farIdx = 0;
    let farD = -1;
    for (let i = 1; i < contour.length; i++) {
      const d = Math.hypot(contour[i][0] - startX, contour[i][1] - startY);
      if (d > farD) {
        farD = d;
        farIdx = i;
      }
    }
    const h1 = douglasPeucker(contour.slice(0, farIdx + 1), epsilonPx);
    const h2 = douglasPeucker(contour.slice(farIdx).concat([contour[0]]), epsilonPx);
    const simplified = h1.slice(0, -1).concat(h2.slice(0, -1));
    return simplified.length >= 3 ? simplified : null;
  }

  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pruneAcuteSpikes(poly) {
    if (!Array.isArray(poly) || poly.length <= 4) return poly;
    let pts = poly.slice();
    for (let pass = 0; pass < 2; pass++) {
      const next = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i - 1 + pts.length) % pts.length];
        const b = pts[i];
        const c = pts[(i + 1) % pts.length];
        const v1x = a[0] - b[0], v1y = a[1] - b[1];
        const v2x = c[0] - b[0], v2y = c[1] - b[1];
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 > 0 && l2 > 0) {
          const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
          if (cos > 0.927 && pts.length - (i - next.length) > 3) continue;
        }
        next.push(b);
      }
      if (next.length >= 3) pts = next;
    }
    return pts;
  }

  function maskToPctResult(rawMask, w, h, labelXPct, labelYPct, solidity = 0.5) {
    let eps = Math.max(4, Math.min(w, h) * 0.01);
    let rawPts = traceMaskContour(rawMask, w, h, eps);
    if (!rawPts || rawPts.length < 3) return null;
    while (rawPts.length > 20 && eps < Math.min(w, h) * 0.08) {
      eps *= 1.35;
      rawPts = traceMaskContour(rawMask, w, h, eps) || rawPts;
    }
    rawPts = pruneAcuteSpikes(rawPts);

    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    const polygon = rawPts.map(([px, py]) => {
      const xp = Math.round((px / w) * 10000) / 100;
      const yp = Math.round((py / h) * 10000) / 100;
      if (xp < minX) minX = xp;
      if (yp < minY) minY = yp;
      if (xp > maxX) maxX = xp;
      if (yp > maxY) maxY = yp;
      return [xp, yp];
    });

    if (Number.isFinite(labelXPct) && Number.isFinite(labelYPct)) {
      if (!pointInPolygon(labelXPct, labelYPct, polygon)) {
        const offsets = [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]];
        const nearInside = offsets.some(([dx, dy]) => pointInPolygon(labelXPct + dx, labelYPct + dy, polygon));
        if (!nearInside) return null;
      }
    }

    return {
      polygon,
      solidity,
      bbox: {
        x: minX.toFixed(1) + '%',
        y: minY.toFixed(1) + '%',
        w: Math.max(2.5, maxX - minX).toFixed(1) + '%',
        h: Math.max(2.5, maxY - minY).toFixed(1) + '%',
      },
    };
  }

  function matchFilesToLabel(labelText, files) {
    if (!labelText || !Array.isArray(files) || files.length === 0) return [];
    const clean = labelText
      .toUpperCase()
      .replace(AREA_RE, '')
      .replace(/[^A-Z0-9\s]/g, ' ');
    const tokens = clean
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !['NO', 'THE', 'AND', 'FOR', 'SITE', 'AREA', 'PLAN', 'VIEW'].includes(t));

    if (tokens.length === 0) return [];

    const matched = [];
    for (const f of files) {
      const hay = `${f.label || ''} ${f.original_name || ''}`.toUpperCase();
      const hit = tokens.some((tok) => {
        if (/^B\d+$/.test(tok)) {
          const num = tok.slice(1);
          return new RegExp(`\\b(${tok}|BLOCK\\s*(?:NO\\.?\\s*)?${num})\\b`, 'i').test(hay);
        }
        return hay.includes(tok);
      });
      if (hit) matched.push(f);
    }
    return matched;
  }

  function extractRasterColorParcels(imgEl, maxDim = 1024) {
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return [];
    try {
      const scale = Math.min(1, maxDim / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
      const w = Math.max(64, Math.round(imgEl.naturalWidth * scale));
      const h = Math.max(64, Math.round(imgEl.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return [];
      ctx.drawImage(imgEl, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const step = 4;
      const gridW = Math.floor(w / step);
      const gridH = Math.floor(h / step);
      const yellowGrid = new Uint8Array(gridW * gridH);
      const greenGrid = new Uint8Array(gridW * gridH);

      const startY = Math.floor(gridH * 0.16);
      const endY = Math.floor(gridH * 0.82);

      for (let gy = startY; gy < endY; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          const px = gx * step;
          const py = gy * step;
          const idx = (py * w + px) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          // Yellow / Amber building
          if (r > 175 && g > 150 && b < 130 && (r - b) > 35) {
            yellowGrid[gy * gridW + gx] = 1;
          }
          // Green landscape
          else if (g > 120 && g > r + 25 && g > b + 25) {
            greenGrid[gy * gridW + gx] = 1;
          }
        }
      }

      const clusterParcels = (grid, category) => {
        const visited = new Uint8Array(grid.length);
        const parcels = [];
        for (let gy = startY; gy < endY; gy++) {
          for (let gx = 0; gx < gridW; gx++) {
            const idx = gy * gridW + gx;
            if (!grid[idx] || visited[idx]) continue;
            let q = [[gx, gy]];
            visited[idx] = 1;
            let minGx = gx, maxGx = gx, minGy = gy, maxGy = gy;
            let count = 0;
            while (q.length > 0) {
              const [cx, cy] = q.pop();
              count++;
              if (cx < minGx) minGx = cx;
              if (cx > maxGx) maxGx = cx;
              if (cy < minGy) minGy = cy;
              if (cy > maxGy) maxGy = cy;
              const nbs = [
                [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
                [cx + 1, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1]
              ];
              for (const [nx, ny] of nbs) {
                if (nx >= 0 && nx < gridW && ny >= startY && ny < endY) {
                  const nIdx = ny * gridW + nx;
                  if (grid[nIdx] && !visited[nIdx]) {
                    visited[nIdx] = 1;
                    q.push([nx, ny]);
                  }
                }
              }
            }
            if (count >= 16) {
              const x1Pct = Math.round((minGx * step / w) * 10000) / 100;
              const y1Pct = Math.round((minGy * step / h) * 10000) / 100;
              const x2Pct = Math.round(((maxGx + 1) * step / w) * 10000) / 100;
              const y2Pct = Math.round(((maxGy + 1) * step / h) * 10000) / 100;
              const wPct = Math.round((x2Pct - x1Pct) * 100) / 100;
              const hPct = Math.round((y2Pct - y1Pct) * 100) / 100;
              const area = wPct * hPct;
              if (area >= 8 && area <= 3500) {
                const poly = [
                  [x1Pct, y1Pct],
                  [x2Pct, y1Pct],
                  [x2Pct, y2Pct],
                  [x1Pct, y2Pct],
                ];
                parcels.push({
                  polygon: poly,
                  bbox: {
                    x: x1Pct.toFixed(1) + '%',
                    y: y1Pct.toFixed(1) + '%',
                    w: Math.max(2.5, wPct).toFixed(1) + '%',
                    h: Math.max(2.5, hPct).toFixed(1) + '%',
                  },
                  area,
                  category,
                  source: 'raster-color',
                });
              }
            }
          }
        }
        return parcels;
      };

      const yellowParcels = clusterParcels(yellowGrid, 'building');
      const greenParcels = clusterParcels(greenGrid, 'landscape');
      return [...yellowParcels, ...greenParcels];
    } catch {
      return [];
    }
  }

  window.SmartAssist = {
    extractPdfLabelsFromBuffer,
    extractRasterColorParcels,
    findVectorPolygonAt,
    maskToPctResult,
    matchFilesToLabel,
    classifyLabel,
  };
})();
