/* ==========================================================================
   ArcSite Studio — Native Vector PDF Extractor & SlimSAM Mask Vectorizer
   1. PDF Text Labels, Areas (SQM/Acres) & Smart File Matching
   2. Native Vector PDF Closed Polygons & Planar CAD Segment Faces (pdf.js OPS)
   3. Clean Mask-to-Polygon Contour Vectorizer for In-Browser SlimSAM (WebGPU)
   ========================================================================== */

(function () {
  'use strict';

  const NOISE_ONLY_RE = /^[\d.,+\-*/°'"()[\]\s:;%]+$/;
  const AREA_RE = /(\d[\d,.]*\s*(?:SQ\.?\s*M|SQM|M2|SQ\.?\s*FT|SQFT|ACRES?|HECTARES?|HA)\b)/i;

  function classifyLabel(text) {
    const u = text.toUpperCase();
    if (/\b(STP|SEWAGE|WTP|SUMP|TANK|WATER)\b/.test(u)) {
      return { zone_type: 'utility', icon: '💧', shape: 'circle' };
    }
    if (/\b(OSR|PARK|GARDEN|LANDSCAPE|LAWN|GREEN)\b/.test(u)) {
      return { zone_type: 'landscape', icon: '🌳', shape: 'rect' };
    }
    if (/\b(METRO|BRIDGE|FLYOVER|VIADUCT|RAIL)\b/.test(u)) {
      return { zone_type: 'transit', icon: '🌉', shape: 'bridge' };
    }
    if (/\b(ROAD|STREET|AVENUE|HIGHWAY|LANE|DRIVEWAY|ENTRY|EXIT|PATH)\b/.test(u)) {
      return { zone_type: 'road', icon: '🛣️', shape: 'road' };
    }
    if (/\b(TEMPLE|MOSQUE|CHURCH|CHAPEL|SHRINE)\b/.test(u)) {
      return { zone_type: 'civic', icon: '🕌', shape: 'rect' };
    }
    if (/\b(ADMIN|SCHOOL|HOSPITAL|HOSTEL|CLINIC)\b/.test(u)) {
      return { zone_type: 'building', icon: '🏫', shape: 'rect' };
    }
    if (/\b(B\d+|BLOCK|TOWER|OFFICE|BUILDING|WING|PHASE|PARKING)\b/.test(u)) {
      return { zone_type: 'building', icon: '🏢', shape: 'rect' };
    }
    return { zone_type: 'zone', icon: '🏛️', shape: 'rect' };
  }

  function isDimensionNumber(str) {
    const t = str.trim();
    if (!t || t.length < 2) return true;
    if (AREA_RE.test(t)) return false;
    return NOISE_ONLY_RE.test(t);
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
      const closedPolys = [];
      const primarySegs = [];
      const allSegs = [];
      let pendingBatch = [];

      const toPct = (px, py) => {
        const [tx, ty] = Util.applyTransform([px, py], ctm);
        const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
        return [(vx / viewport.width) * 100, (vy / viewport.height) * 100];
      };

      const recordSubpath = (pts, closed, isGray) => {
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
            if (
              !isGray &&
              area >= 12 &&
              area <= 4200 &&
              !(info.wNum > 88 && info.hNum > 88) &&
              clean.every(([x, y]) => x >= -2 && x <= 102 && y >= -2 && y <= 102)
            ) {
              const solidity = area / Math.max(0.01, info.wNum * info.hNum);
              if (solidity >= 0.26) {
                closedPolys.push({
                  polygon: clean,
                  bbox: info.bbox,
                  area,
                  solidity,
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

      const flushPendingBatch = (forceClose = false) => {
        for (const item of pendingBatch) {
          recordSubpath(item.pts, item.closed || forceClose, item.isGray);
        }
        pendingBatch = [];
      };

      const collectOps = (subOps, coords) => {
        if (!subOps || !coords) return;
        let c = 0;
        let cur = [];
        let curClosed = false;
        const pushCur = () => {
          if (cur.length >= 2) pendingBatch.push({ pts: cur, closed: curClosed, isGray: strokeIsGray });
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
          ctmStack.push({ ctm: ctm.slice(), gray: strokeIsGray });
        } else if (fn === OPS.restore) {
          if (ctmStack.length) {
            const st = ctmStack.pop();
            ctm = st.ctm;
            strokeIsGray = st.gray;
          }
        } else if (fn === OPS.transform && Array.isArray(args)) {
          ctm = Util.transform(ctm, args);
        } else if (fn === OPS.paintFormXObjectBegin) {
          ctmStack.push({ ctm: ctm.slice(), gray: strokeIsGray });
          if (args && Array.isArray(args[0])) ctm = Util.transform(ctm, args[0]);
        } else if (fn === OPS.paintFormXObjectEnd) {
          if (ctmStack.length) {
            const st = ctmStack.pop();
            ctm = st.ctm;
            strokeIsGray = st.gray;
          }
        } else if (fn === OPS.setStrokeRGBColor || fn === OPS.setStrokeGray || fn === OPS.setFillRGBColor || fn === OPS.setFillGray) {
          strokeIsGray = parsePdfGrayHatchFlag(args, strokeIsGray);
        } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 2) {
          flushPendingBatch(false);
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
          const closedOp = fn === OPS.closeStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
          flushPendingBatch(closedOp);
          if (standaloneCur.length >= 2) {
            recordSubpath(standaloneCur, standaloneClosed || closedOp, strokeIsGray);
          }
          standaloneCur = [];
          standaloneClosed = false;
        } else if (fn === OPS.moveTo && Array.isArray(args) && args.length >= 2) {
          if (standaloneCur.length >= 2) pendingBatch.push({ pts: standaloneCur, closed: standaloneClosed, isGray: strokeIsGray });
          standaloneCur = [toPct(args[0], args[1])];
          standaloneClosed = false;
        } else if (fn === OPS.lineTo && Array.isArray(args) && args.length >= 2) {
          standaloneCur.push(toPct(args[0], args[1]));
        } else if (fn === OPS.closePath) {
          standaloneClosed = true;
          if (standaloneCur.length >= 2) pendingBatch.push({ pts: standaloneCur, closed: true, isGray: strokeIsGray });
          standaloneCur = [];
          standaloneClosed = false;
        } else if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
          const [rx, ry, rw, rh] = args;
          if (Math.abs(rw) > 0 && Math.abs(rh) > 0) {
            pendingBatch.push({
              pts: [toPct(rx, ry), toPct(rx + rw, ry), toPct(rx + rw, ry + rh), toPct(rx, ry + rh)],
              closed: true,
              isGray: strokeIsGray,
            });
          }
        }
      }
      flushPendingBatch(false);
      if (standaloneCur.length >= 2) recordSubpath(standaloneCur, standaloneClosed, strokeIsGray);

      closedPolys.sort((a, b) => a.area - b.area);
      const chosenSegs = primarySegs.length >= 6 ? primarySegs : allSegs;
      const findFaceAt = buildPlanarFaceFinder(chosenSegs);
      return { closedPolys, segmentCount: chosenSegs.length, findFaceAt };
    } catch {
      return { closedPolys: [], findFaceAt: null };
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

    let siteAreaText = '';
    let siteAreaAnchor = null;
    const labels = [];
    const areaTokens = [];

    for (const line of lines) {
      const t = line.text.trim();
      if (/OVERALL\s*SITE\s*AREA|TOTAL\s*SITE\s*AREA/i.test(t)) {
        siteAreaText = t;
        siteAreaAnchor = { xPct: line.xPct, yPct: line.yPct };
        continue;
      }
      if (
        siteAreaAnchor &&
        Math.abs(line.xPct - siteAreaAnchor.xPct) <= 8 &&
        line.yPct - siteAreaAnchor.yPct >= 0 &&
        line.yPct - siteAreaAnchor.yPct <= 4.5 &&
        AREA_RE.test(t)
      ) {
        siteAreaText = `${siteAreaText} ${t}`.replace(/\s+/g, ' ').trim();
        continue;
      }
      if (isDimensionNumber(t)) continue;

      const areaMatch = t.match(AREA_RE);
      if (areaMatch && t.replace(AREA_RE, '').trim().length < 2) {
        areaTokens.push({ area: areaMatch[1].trim(), xPct: line.xPct, yPct: line.yPct });
        continue;
      }

      const cls = classifyLabel(t);
      const centerX = (line.xPct + line.maxX) / 2;
      labels.push({
        text: t,
        area: areaMatch ? areaMatch[1].trim() : '',
        zone_type: cls.zone_type,
        icon: cls.icon,
        shape: cls.shape,
        xPct: Math.round(centerX * 100) / 100,
        yPct: Math.round(line.yPct * 100) / 100,
      });
    }

    for (const tok of areaTokens) {
      let best = null;
      let bestDist = Infinity;
      for (const lbl of labels) {
        if (lbl.area) continue;
        const dx = Math.abs(lbl.xPct - tok.xPct);
        const dy = tok.yPct - lbl.yPct;
        if (dx <= 5.5 && dy >= -1.5 && dy <= 4.5) {
          const d = dx + Math.abs(dy);
          if (d < bestDist) {
            bestDist = d;
            best = lbl;
          }
        }
      }
      if (best) {
        best.area = tok.area;
      } else if (!siteAreaText && /ACRE|HECTARE/i.test(tok.area)) {
        siteAreaText = tok.area;
      }
    }

    const deduped = [];
    for (const lbl of labels) {
      const canVecTrace = lbl.zone_type !== 'road' && !(lbl.zone_type === 'transit' && /BRIDGE/i.test(lbl.text));
      if (canVecTrace && vectorGeometry) {
        const vecMatch = findVectorPolygonAt(vectorGeometry, lbl.xPct, lbl.yPct);
        if (vecMatch) {
          lbl.vectorPolygon = vecMatch.polygon;
          lbl.vectorBbox = vecMatch.bbox;
          lbl.vectorSource = vecMatch.source || 'vector-pdf';
        }
      }
      const isRoad = lbl.zone_type === 'road' || lbl.zone_type === 'transit';
      const maxDist = isRoad ? 28 : 5;
      const dup = deduped.find(
        (x) =>
          x.text.toLowerCase() === lbl.text.toLowerCase() &&
          Math.hypot(x.xPct - lbl.xPct, x.yPct - lbl.yPct) < maxDist
      );
      if (!dup) deduped.push(lbl);
    }

    return {
      siteAreaText,
      labels: deduped.slice(0, 80),
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

  window.SmartAssist = {
    extractPdfLabelsFromBuffer,
    findVectorPolygonAt,
    maskToPctResult,
    matchFilesToLabel,
    classifyLabel,
  };
})();
