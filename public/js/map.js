/* ==========================================================================
   ArcSite Navigator — Map Zoom & Pan Controller
   ========================================================================== */

(function () {
  'use strict';

  const MapController = {
    state: {
      scale: 1,
      translateX: 0,
      translateY: 0,
    },
    MIN_SCALE: 0.3,
    MAX_SCALE: 5.0,
    isPanning: false,
    startX: 0,
    startY: 0,
    startTX: 0,
    startTY: 0,
    pinchStartDist: 0,
    pinchStartScale: 1,

    init() {
      const viewport = document.getElementById('map-viewport');
      if (!viewport) return;

      document.getElementById('zoom-in-btn')?.addEventListener('click', () => {
        MapController.zoomBy(0.15);
      });
      document.getElementById('zoom-out-btn')?.addEventListener('click', () => {
        MapController.zoomBy(-0.15);
      });
      document.getElementById('zoom-fit-btn')?.addEventListener('click', () => {
        MapController.fit();
      });

      // Mouse wheel zoom centered on cursor
      viewport.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const rect = viewport.getBoundingClientRect();
          const cx = e.clientX - rect.left - rect.width / 2;
          const cy = e.clientY - rect.top - rect.height / 2;

          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          MapController.zoomAt(MapController.state.scale * factor, cx, cy);
        },
        { passive: false }
      );

      // Mouse pan
      viewport.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (window.ProjectController?.polyDraw?.active || window.ProjectController?.magicTraceActive) return;
        if (e.target.closest('.hotspot') || e.target.closest('.resize-handle') || e.target.closest('.sa-ghost-pin')) return;
        MapController.isPanning = true;
        MapController.startX = e.clientX;
        MapController.startY = e.clientY;
        MapController.startTX = MapController.state.translateX;
        MapController.startTY = MapController.state.translateY;
        viewport.classList.add('panning');
        document.getElementById('map-transform')?.classList.add('no-transition');
      });

      window.addEventListener('mousemove', (e) => {
        if (!MapController.isPanning) return;
        const dx = e.clientX - MapController.startX;
        const dy = e.clientY - MapController.startY;
        MapController.state.translateX = MapController.startTX + dx;
        MapController.state.translateY = MapController.startTY + dy;
        MapController.applyTransform();
      });

      window.addEventListener('mouseup', () => {
        if (!MapController.isPanning) return;
        MapController.isPanning = false;
        viewport.classList.remove('panning');
        document.getElementById('map-transform')?.classList.remove('no-transition');
      });

      // Touch pan & pinch-zoom
      viewport.addEventListener(
        'touchstart',
        (e) => {
          if (e.target.closest('.hotspot') || e.target.closest('.resize-handle')) return;
          if (e.touches.length === 1) {
            MapController.isPanning = true;
            MapController.startX = e.touches[0].clientX;
            MapController.startY = e.touches[0].clientY;
            MapController.startTX = MapController.state.translateX;
            MapController.startTY = MapController.state.translateY;
            document.getElementById('map-transform')?.classList.add('no-transition');
          } else if (e.touches.length === 2) {
            MapController.isPanning = false;
            MapController.pinchStartDist = MapController.touchDist(e.touches);
            MapController.pinchStartScale = MapController.state.scale;
          }
        },
        { passive: true }
      );

      viewport.addEventListener(
        'touchmove',
        (e) => {
          if (e.touches.length === 1 && MapController.isPanning) {
            e.preventDefault();
            const dx = e.touches[0].clientX - MapController.startX;
            const dy = e.touches[0].clientY - MapController.startY;
            MapController.state.translateX = MapController.startTX + dx;
            MapController.state.translateY = MapController.startTY + dy;
            MapController.applyTransform();
          } else if (e.touches.length === 2 && MapController.pinchStartDist > 0) {
            e.preventDefault();
            const dist = MapController.touchDist(e.touches);
            const nextScale = MapController.pinchStartScale * (dist / MapController.pinchStartDist);
            MapController.setScale(nextScale);
          }
        },
        { passive: false }
      );

      viewport.addEventListener('touchend', () => {
        MapController.isPanning = false;
        MapController.pinchStartDist = 0;
        document.getElementById('map-transform')?.classList.remove('no-transition');
      });
    },

    touchDist(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    },

    clampScale(s) {
      return Math.min(MapController.MAX_SCALE, Math.max(MapController.MIN_SCALE, s));
    },

    setScale(newScale) {
      MapController.state.scale = MapController.clampScale(newScale);
      MapController.applyTransform();
    },

    zoomBy(delta) {
      const next = Math.round((MapController.state.scale + delta) * 100) / 100;
      MapController.setScale(next);
    },

    zoomAt(targetScale, cx, cy) {
      const prevScale = MapController.state.scale;
      const nextScale = MapController.clampScale(targetScale);
      if (nextScale === prevScale) return;

      const ratio = nextScale / prevScale;
      MapController.state.translateX = cx - (cx - MapController.state.translateX) * ratio;
      MapController.state.translateY = cy - (cy - MapController.state.translateY) * ratio;
      MapController.state.scale = nextScale;
      MapController.applyTransform();
    },

    fit() {
      MapController.state.scale = 1;
      MapController.state.translateX = 0;
      MapController.state.translateY = 0;
      MapController.applyTransform();
    },

    applyTransform() {
      const el = document.getElementById('map-transform');
      const disp = document.getElementById('zoom-display');
      const { scale, translateX, translateY } = MapController.state;
      if (el) {
        el.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      }
      if (disp) {
        disp.textContent = `${Math.round(scale * 100)}%`;
      }
    },
  };

  window.MapController = MapController;
})();
