/* ==========================================================================
   ArcSite Studio — Building Pattern Learning Engine (Architectural AI)
   Learns master plan structural patterns:
   - Dominant site grid orientation angle (Hough/Radon angle clustering)
   - Structural bay modular rhythm (repeating bay widths/depths & column intervals)
   - Architectural footprint archetypes (Standard-Bay, Stepped-L-Shape, Compact-Cabin)
   - Rectifies organic/wobbly contours into razor-sharp, orthogonal CAD polygons
   ========================================================================== */

(function () {
  'use strict';

  class BuildingPatternEngine {
    constructor() {
      this.currentModel = null;
      this.cacheByProjectId = new Map();
    }

    /**
     * Learn the master plan's architectural grammar and structural footprint patterns.
     * @param {Object} vectorGeometry - Vector context extracted from PDF or CAD layer
     * @param {Array} textLabels - Detected space and building labels
     * @returns {Object} SitePatternModel
     */
    learnPatterns(vectorGeometry, textLabels = []) {
      if (!vectorGeometry) {
        return this._defaultModel();
      }

      const wallSegs = vectorGeometry.wallSegs || vectorGeometry.primarySegs || [];
      const closedPolys = vectorGeometry.closedPolys || [];

      // 1. Detect Dominant Grid Orientation (Radon / Angle Histogram)
      const angleHistogram = new Float32Array(90);
      let totalWeight = 0;

      for (const [p1, p2] of wallSegs) {
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.6 || len > 50) continue;

        let deg = (Math.atan2(dy, dx) * 180 / Math.PI) % 180;
        if (deg < 0) deg += 180;

        // Fold into [0, 90) quadrant for orthogonal alignment
        const folded = deg % 90;
        const bin = Math.min(89, Math.max(0, Math.round(folded)));
        angleHistogram[bin] += len;
        totalWeight += len;
      }

      // Find peak orientation angle with Gaussian smoothing
      let peakBin = 0;
      let peakVal = 0;
      for (let b = 0; b < 90; b++) {
        let smoothed = 0;
        for (let k = -2; k <= 2; k++) {
          const idx = (b + k + 90) % 90;
          const weight = (k === 0) ? 0.4 : (Math.abs(k) === 1 ? 0.24 : 0.06);
          smoothed += angleHistogram[idx] * weight;
        }
        if (smoothed > peakVal) {
          peakVal = smoothed;
          peakBin = b;
        }
      }

      const dominantAngleDeg = peakBin <= 2 || peakBin >= 88 ? 0 : peakBin;
      const dominantAngleRad = (dominantAngleDeg * Math.PI) / 180;
      const isRotatedPlan = Math.abs(dominantAngleDeg) > 1.5;

      // 2. Discover Building Bay Modules (Repetitive widths, heights & column spacing)
      const bayWidths = [];
      const bayHeights = [];

      const buildings = closedPolys.filter((p) => {
        const w = parseFloat(p.bbox?.w || p.w || 0);
        const h = parseFloat(p.bbox?.h || p.h || 0);
        return w >= 3.0 && h >= 2.0 && w <= 80 && h <= 50;
      });

      for (const b of buildings) {
        const bw = parseFloat(b.bbox?.w || b.w || 0);
        const bh = parseFloat(b.bbox?.h || b.h || 0);
        bayWidths.push(bw);
        bayHeights.push(bh);
      }

      const median = (arr) => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };

      const modalBayW = Math.round(median(bayWidths) * 10) / 10;
      const modalBayH = Math.round(median(bayHeights) * 10) / 10;

      // 3. Cluster Building Archetypes
      const archetypes = [
        {
          name: 'Standard-Warehouse',
          label: 'Standard Bay Warehouse',
          minW: 12.0,
          minH: 4.0,
          count: buildings.filter((b) => parseFloat(b.bbox?.w || 0) >= 12).length,
        },
        {
          name: 'Stepped-L-Shape',
          label: 'Stepped / L-Shaped Warehouse',
          count: buildings.filter((b) => b.polygon?.length >= 6).length,
        },
        {
          name: 'Compact-Facility',
          label: 'Compact Cabin / Utility',
          minW: 0.5,
          maxW: 8.0,
          count: closedPolys.filter(
            (p) => parseFloat(p.bbox?.w || 0) <= 8 && parseFloat(p.bbox?.h || 0) <= 8
          ).length,
        },
      ];

      const model = {
        dominantAngleDeg,
        dominantAngleRad,
        isRotatedPlan,
        modalBayW,
        modalBayH,
        buildingsCount: buildings.length,
        archetypes,
        confidence: totalWeight > 50 ? 0.98 : 0.85,
        learnedAt: Date.now(),
      };

      this.currentModel = model;
      return model;
    }

    /**
     * Rectifies any polygon (from vector parsing or vision mask) against the learned architectural pattern.
     * Snaps edges to the learned grid angle, cleans micro-steps, and closes exact 90° corners.
     * @param {Array} pts - [[x, y], ...]
     * @param {Object} patternModel - Optional learned model (defaults to currentModel)
     * @returns {Array} Rectified polygon points
     */
    rectifyPolygon(pts, patternModel = null) {
      if (!Array.isArray(pts) || pts.length < 3) return pts;
      const model = patternModel || this.currentModel || { dominantAngleRad: 0, dominantAngleDeg: 0 };
      const theta = model.dominantAngleRad || 0;

      // Center of polygon
      let cx = 0, cy = 0;
      for (const [x, y] of pts) {
        cx += x;
        cy += y;
      }
      cx /= pts.length;
      cy /= pts.length;

      const cosT = Math.cos(-theta);
      const sinT = Math.sin(-theta);
      const cosInv = Math.cos(theta);
      const sinInv = Math.sin(theta);

      // 1. Rotate polygon to canonical horizontal/vertical space
      const canonical = pts.map(([x, y]) => {
        const dx = x - cx;
        const dy = y - cy;
        return [
          cx + (dx * cosT - dy * sinT),
          cy + (dx * sinT + dy * cosT),
        ];
      });

      // 2. Rectify edges to strict orthogonal axes in canonical space
      const n = canonical.length;
      const rectified = [];

      for (let i = 0; i < n; i++) {
        const cur = [canonical[i][0], canonical[i][1]];
        const next = [canonical[(i + 1) % n][0], canonical[(i + 1) % n][1]];
        const dx = next[0] - cur[0];
        const dy = next[1] - cur[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.2) continue; // skip degenerate zero-length micro-edges

        // Snap near-horizontal edges
        if (Math.abs(dy) <= 0.65 || Math.abs(dy) / len < 0.15) {
          const avgY = (cur[1] + next[1]) / 2;
          cur[1] = avgY;
          next[1] = avgY;
        }
        // Snap near-vertical edges
        else if (Math.abs(dx) <= 0.65 || Math.abs(dx) / len < 0.15) {
          const avgX = (cur[0] + next[0]) / 2;
          cur[0] = avgX;
          next[0] = avgX;
        }
        rectified.push(cur);
      }

      // 3. Clean collinear points
      const cleaned = [];
      const rN = rectified.length;
      for (let i = 0; i < rN; i++) {
        const prev = rectified[(i - 1 + rN) % rN];
        const cur = rectified[i];
        const next = rectified[(i + 1) % rN];
        const cross = (cur[0] - prev[0]) * (next[1] - prev[1]) - (cur[1] - prev[1]) * (next[0] - prev[0]);
        if (Math.abs(cross) > 1e-4) {
          cleaned.push([
            Math.round(cur[0] * 100) / 100,
            Math.round(cur[1] * 100) / 100,
          ]);
        }
      }

      const finalCanonical = cleaned.length >= 3 ? cleaned : rectified;

      // 4. Rotate back to actual master plan coordinates
      if (Math.abs(theta) > 0.01) {
        return finalCanonical.map(([x, y]) => {
          const dx = x - cx;
          const dy = y - cy;
          return [
            Math.round((cx + (dx * cosInv - dy * sinInv)) * 100) / 100,
            Math.round((cy + (dx * sinInv + dy * cosInv)) * 100) / 100,
          ];
        });
      }

      return finalCanonical;
    }

    /**
     * Classifies a building footprint into a learned architectural archetype.
     * @param {Object} bbox - { w, h }
     * @param {Array} polygon - [[x, y], ...]
     * @returns {string} Archetype key
     */
    classifyArchetype(bbox, polygon = []) {
      const bw = parseFloat(bbox.w || 0);
      const bh = parseFloat(bbox.h || 0);
      const pts = polygon.length;

      if (bw <= 8.0 && bh <= 8.0 && bw * bh <= 45) {
        return 'Compact-Facility';
      }
      if (pts >= 6) {
        return 'Stepped-L-Shape';
      }
      if (bw >= 12.0 || bh >= 10.0) {
        return 'Standard-Warehouse';
      }
      return 'Standard-Building';
    }

    _defaultModel() {
      return {
        dominantAngleDeg: 0,
        dominantAngleRad: 0,
        isRotatedPlan: false,
        modalBayW: 15.0,
        modalBayH: 8.0,
        buildingsCount: 0,
        archetypes: [],
        confidence: 0.5,
      };
    }
  }

  const engine = new BuildingPatternEngine();

  if (typeof window !== 'undefined') {
    window.BuildingPatternEngine = engine;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine;
  }
})();
