/* ==========================================================================
   ArcSite Navigator — Unified File Viewer Manager
   ========================================================================== */

(function () {
  'use strict';

  const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const ViewerManager = {
    projectId: null,
    file: null,
    cleanupFn: null,
    pdfDoc: null,
    pdfPage: 1,
    pdfScale: 1.25,
    pdfRendering: false,

    init() {
      document.getElementById('viewer-close')?.addEventListener('click', () => {
        ViewerManager.close();
      });
      document.getElementById('viewer-download')?.addEventListener('click', () => {
        ViewerManager.triggerDownload();
      });
      document.getElementById('viewer-content')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-viewer-download]')) {
          ViewerManager.triggerDownload();
        }
      });

      document.getElementById('pdf-prev')?.addEventListener('click', () => {
        if (ViewerManager.pdfDoc && ViewerManager.pdfPage > 1) {
          ViewerManager.pdfPage--;
          ViewerManager.renderPdfPage();
        }
      });
      document.getElementById('pdf-next')?.addEventListener('click', () => {
        if (ViewerManager.pdfDoc && ViewerManager.pdfPage < ViewerManager.pdfDoc.numPages) {
          ViewerManager.pdfPage++;
          ViewerManager.renderPdfPage();
        }
      });
      document.getElementById('pdf-zoom-in')?.addEventListener('click', () => {
        if (ViewerManager.pdfDoc) {
          ViewerManager.pdfScale = Math.min(3.5, ViewerManager.pdfScale + 0.25);
          ViewerManager.renderPdfPage();
        }
      });
      document.getElementById('pdf-zoom-out')?.addEventListener('click', () => {
        if (ViewerManager.pdfDoc) {
          ViewerManager.pdfScale = Math.max(0.5, ViewerManager.pdfScale - 0.25);
          ViewerManager.renderPdfPage();
        }
      });
    },

    getExt(file) {
      const name = file.original_name || file.stored_name || file.label || '';
      const dot = name.lastIndexOf('.');
      return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    },

    getInlineUrl(projectId, fileId) {
      return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download?inline=1`;
    },

    getDownloadUrl(projectId, fileId) {
      return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download`;
    },

    triggerDownload() {
      if (!ViewerManager.projectId || !ViewerManager.file) return;
      const url = ViewerManager.getDownloadUrl(ViewerManager.projectId, ViewerManager.file.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = ViewerManager.file.original_name || ViewerManager.file.label || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },

    close() {
      if (typeof ViewerManager.cleanupFn === 'function') {
        try {
          ViewerManager.cleanupFn();
        } catch {
          // ignore
        }
        ViewerManager.cleanupFn = null;
      }
      ViewerManager.pdfDoc = null;
      document.getElementById('viewer-pdf-controls').hidden = true;
      document.getElementById('viewer-content').innerHTML = '';
      document.getElementById('viewer-overlay').hidden = true;
    },

    async open(projectId, file) {
      ViewerManager.close();
      ViewerManager.projectId = projectId;
      ViewerManager.file = file;

      const overlay = document.getElementById('viewer-overlay');
      const filenameEl = document.getElementById('viewer-filename');
      const contentEl = document.getElementById('viewer-content');

      filenameEl.textContent = file.original_name || file.label || 'File Preview';
      contentEl.innerHTML = '<div style="color:#94A3B8;font-size:14px;">Loading preview…</div>';
      overlay.hidden = false;

      // Try fetching enriched file metadata from backend
      try {
        const info = await App.api(
          `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}`
        );
        if (info && info.file) {
          ViewerManager.file = info.file;
        }
      } catch {
        // Proceed with passed file object
      }

      const f = ViewerManager.file;
      const ext = ViewerManager.getExt(f);
      const inlineUrl = ViewerManager.getInlineUrl(projectId, f.id);

      if (ext === 'pdf') {
        await ViewerManager.openPdf(inlineUrl, contentEl);
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) {
        ViewerManager.openImage(inlineUrl, f, contentEl);
      } else if (ext === 'tif' || ext === 'tiff') {
        if (f.thumbnail_url) {
          ViewerManager.openImage(f.thumbnail_url, f, contentEl);
        } else {
          ViewerManager.openGeneric(f, contentEl);
        }
      } else if (['glb', 'gltf', 'obj', 'stl'].includes(ext)) {
        await ViewerManager.open3DModel(inlineUrl, ext, f, contentEl);
      } else if (ext === 'dxf') {
        await ViewerManager.openDxf(inlineUrl, f, contentEl);
      } else if (ext === 'ifc') {
        await ViewerManager.openIfc(inlineUrl, f, contentEl);
      } else if (['skp', 'skb', 'dwg', 'bak', 'rvt', 'rfa', '3dm', 'fbx'].includes(ext)) {
        ViewerManager.openProprietaryCad(ext, f, contentEl);
      } else if (ext === 'pptx') {
        ViewerManager.openPptx(f, contentEl);
      } else if (['txt', 'csv', 'json', 'md', 'log'].includes(ext)) {
        await ViewerManager.openText(inlineUrl, contentEl);
      } else if (['html', 'htm'].includes(ext)) {
        ViewerManager.openHtml(inlineUrl, contentEl);
      } else {
        ViewerManager.openGeneric(f, contentEl);
      }
    },

    /* ---------------- 1. PDF Viewer ---------------- */
    loadPdfJs() {
      if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PDFJS_CDN;
        script.onload = () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            resolve(window.pdfjsLib);
          } else {
            reject(new Error('pdfjsLib not found'));
          }
        };
        script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
        document.head.appendChild(script);
      });
    },

    async openPdf(url, container) {
      try {
        const pdfjsLib = await ViewerManager.loadPdfJs();
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Failed to fetch PDF');
        const buf = await res.arrayBuffer();

        ViewerManager.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
        ViewerManager.pdfPage = 1;
        ViewerManager.pdfScale = 1.25;

        container.innerHTML = '<canvas id="pdf-canvas" class="viewer-canvas"></canvas>';
        document.getElementById('viewer-pdf-controls').hidden = false;
        await ViewerManager.renderPdfPage();
      } catch (err) {
        container.innerHTML = `
          <div class="viewer-meta-card">
            <h3>PDF Preview Unavailable</h3>
            <p style="color:#94A3B8;margin:10px 0 18px">${App.escapeHtml(err.message)}</p>
            <button type="button" class="btn btn-primary" data-viewer-download>Download PDF</button>
          </div>`;
      }
    },

    async renderPdfPage() {
      if (!ViewerManager.pdfDoc || ViewerManager.pdfRendering) return;
      ViewerManager.pdfRendering = true;
      try {
        const page = await ViewerManager.pdfDoc.getPage(ViewerManager.pdfPage);
        const viewport = page.getViewport({ scale: ViewerManager.pdfScale });
        const canvas = document.getElementById('pdf-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;

        document.getElementById('pdf-page-info').textContent =
          `Page ${ViewerManager.pdfPage} / ${ViewerManager.pdfDoc.numPages}`;
        document.getElementById('pdf-zoom-info').textContent =
          `${Math.round(ViewerManager.pdfScale * 100)}%`;
      } finally {
        ViewerManager.pdfRendering = false;
      }
    },

    /* ---------------- 2. Image Lightbox ---------------- */
    openImage(url, file, container) {
      container.innerHTML = `
        <div class="viewer-image-wrap" id="img-lightbox-wrap">
          <img id="img-lightbox-img" src="${App.escapeHtml(url)}" alt="${App.escapeHtml(file.original_name || 'Image')}">
        </div>
      `;
      const wrap = document.getElementById('img-lightbox-wrap');
      const img = document.getElementById('img-lightbox-img');
      let scale = 1;
      let tx = 0;
      let ty = 0;
      let dragging = false;
      let sx = 0;
      let sy = 0;

      const apply = () => {
        img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      };

      const onWheel = (e) => {
        e.preventDefault();
        scale = Math.min(6, Math.max(0.25, scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        apply();
      };
      const onDown = (e) => {
        dragging = true;
        sx = e.clientX - tx;
        sy = e.clientY - ty;
        wrap.style.cursor = 'grabbing';
      };
      const onMove = (e) => {
        if (!dragging) return;
        tx = e.clientX - sx;
        ty = e.clientY - sy;
        apply();
      };
      const onUp = () => {
        dragging = false;
        wrap.style.cursor = 'grab';
      };

      wrap.addEventListener('wheel', onWheel, { passive: false });
      wrap.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      ViewerManager.cleanupFn = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    },

    /* ---------------- 3. Three.js 3D Model Viewer ---------------- */
    async open3DModel(url, ext, file, container) {
      container.innerHTML = `
        <div style="width:100%;height:100%;position:relative;display:flex;flex-direction:column;">
          <div id="three-toolbar" style="position:absolute;top:12px;left:12px;z-index:5;display:flex;gap:8px;background:rgba(15,23,42,0.8);padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);">
            <button type="button" class="btn btn-ghost btn-xs" id="three-wireframe" style="color:#fff">Wireframe</button>
            <button type="button" class="btn btn-ghost btn-xs" id="three-reset" style="color:#fff">Fit Camera</button>
          </div>
          <div id="three-mount" style="flex:1;width:100%;height:100%;background:#0B1120;border-radius:12px;overflow:hidden;"></div>
        </div>
      `;

      const mount = document.getElementById('three-mount');
      try {
        const [THREE, { OrbitControls }, { GLTFLoader }, { OBJLoader }, { STLLoader }] = await Promise.all([
          import('https://esm.sh/three@0.160.0'),
          import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
          import('https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js'),
          import('https://esm.sh/three@0.160.0/examples/jsm/loaders/OBJLoader.js'),
          import('https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js'),
        ]);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0b1120);

        const w = mount.clientWidth || 800;
        const h = mount.clientHeight || 500;
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 10000);
        camera.position.set(5, 5, 5);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mount.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1.1);
        dir.position.set(10, 20, 15);
        scene.add(dir);

        const grid = new THREE.GridHelper(20, 20, 0x0284c7, 0x1e293b);
        scene.add(grid);

        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Failed to download 3D model');
        const buf = await res.arrayBuffer();

        let rootObj;
        if (ext === 'glb' || ext === 'gltf') {
          const loader = new GLTFLoader();
          const gltf = await new Promise((resolve, reject) => {
            loader.parse(buf, '', resolve, reject);
          });
          rootObj = gltf.scene;
        } else if (ext === 'obj') {
          const text = new TextDecoder().decode(buf);
          rootObj = new OBJLoader().parse(text);
        } else if (ext === 'stl') {
          const geom = new STLLoader().parse(buf);
          const mat = new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.45, metalness: 0.15 });
          rootObj = new THREE.Mesh(geom, mat);
        }

        if (rootObj) {
          scene.add(rootObj);
          const fitCamera = () => {
            const box = new THREE.Box3().setFromObject(rootObj);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const dist = maxDim * 1.8;
            camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
            controls.target.copy(center);
            controls.update();
          };
          fitCamera();

          document.getElementById('three-reset')?.addEventListener('click', fitCamera);
          let wire = false;
          document.getElementById('three-wireframe')?.addEventListener('click', (e) => {
            wire = !wire;
            e.target.style.background = wire ? 'var(--accent)' : '';
            rootObj.traverse((child) => {
              if (child.isMesh && child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((m) => { m.wireframe = wire; });
              }
            });
          });
        }

        let rafId = 0;
        const animate = () => {
          rafId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        const onResize = () => {
          const nw = mount.clientWidth || 800;
          const nh = mount.clientHeight || 500;
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        };
        window.addEventListener('resize', onResize);

        ViewerManager.cleanupFn = () => {
          cancelAnimationFrame(rafId);
          window.removeEventListener('resize', onResize);
          controls.dispose();
          renderer.dispose();
        };
      } catch (err) {
        container.innerHTML = `
          <div class="viewer-placeholder">
            <span class="viewer-placeholder-badge">3D Model Viewer (${App.escapeHtml(ext.toUpperCase())})</span>
            <h3>${App.escapeHtml(file.original_name || file.label)}</h3>
            <p>Could not render 3D preview in browser (${App.escapeHtml(err.message)}).</p>
            <button type="button" class="btn btn-primary" data-viewer-download>Download Model</button>
          </div>`;
      }
    },

    /* ---------------- 4. DXF 2D CAD Viewer ---------------- */
    parseDxfFallback(text) {
      const lines = text.split(/\r?\n/);
      const entities = [];
      let inEntities = false;
      let cur = null;
      let polyVert = null;

      for (let i = 0; i < lines.length - 1; i += 2) {
        const code = lines[i].trim();
        const val = lines[i + 1].trim();
        if (code === '2' && val === 'ENTITIES') {
          inEntities = true;
          continue;
        }
        if (code === '0' && val === 'ENDSEC' && inEntities) {
          if (cur) entities.push(cur);
          break;
        }
        if (!inEntities) continue;

        if (code === '0') {
          if (val === 'VERTEX' && cur && cur.type === 'POLYLINE') {
            polyVert = { x: 0, y: 0 };
            cur.vertices.push(polyVert);
            continue;
          }
          if (val === 'SEQEND') {
            polyVert = null;
            continue;
          }
          if (cur) entities.push(cur);
          cur = { type: val, layer: '0', vertices: [] };
          polyVert = null;
          continue;
        }
        if (!cur) continue;

        if (code === '8') cur.layer = val;
        if (cur.type === 'LINE') {
          if (code === '10') cur.x1 = parseFloat(val);
          if (code === '20') cur.y1 = parseFloat(val);
          if (code === '11') cur.x2 = parseFloat(val);
          if (code === '21') cur.y2 = parseFloat(val);
        } else if (cur.type === 'CIRCLE' || cur.type === 'ARC') {
          if (code === '10') cur.cx = parseFloat(val);
          if (code === '20') cur.cy = parseFloat(val);
          if (code === '40') cur.r = parseFloat(val);
          if (code === '50') cur.startAngle = (parseFloat(val) * Math.PI) / 180;
          if (code === '51') cur.endAngle = (parseFloat(val) * Math.PI) / 180;
        } else if (cur.type === 'LWPOLYLINE') {
          if (code === '10') cur.vertices.push({ x: parseFloat(val), y: 0 });
          if (code === '20' && cur.vertices.length > 0) {
            cur.vertices[cur.vertices.length - 1].y = parseFloat(val);
          }
          if (code === '70') cur.closed = (parseInt(val, 10) & 1) === 1;
        } else if (cur.type === 'POLYLINE' && polyVert) {
          if (code === '10') polyVert.x = parseFloat(val);
          if (code === '20') polyVert.y = parseFloat(val);
        } else if (cur.type === 'TEXT' || cur.type === 'MTEXT') {
          if (code === '10') cur.x = parseFloat(val);
          if (code === '20') cur.y = parseFloat(val);
          if (code === '1') cur.text = val;
        }
      }
      return entities;
    },

    normalizeDxfEntities(parsed) {
      if (!parsed || !Array.isArray(parsed.entities)) return [];
      return parsed.entities.map((e) => {
        if (e.type === 'LINE' && e.vertices && e.vertices.length >= 2) {
          return {
            type: 'LINE',
            layer: e.layer || '0',
            x1: e.vertices[0].x,
            y1: e.vertices[0].y,
            x2: e.vertices[1].x,
            y2: e.vertices[1].y,
          };
        }
        if ((e.type === 'CIRCLE' || e.type === 'ARC') && e.center) {
          return {
            type: e.type,
            layer: e.layer || '0',
            cx: e.center.x,
            cy: e.center.y,
            r: e.radius,
            startAngle: e.startAngle || 0,
            endAngle: e.endAngle || Math.PI * 2,
          };
        }
        if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices) {
          return {
            type: 'LWPOLYLINE',
            layer: e.layer || '0',
            vertices: e.vertices,
            closed: !!e.shape,
          };
        }
        if ((e.type === 'TEXT' || e.type === 'MTEXT') && (e.startPoint || e.position)) {
          const pt = e.startPoint || e.position;
          return { type: 'TEXT', layer: e.layer || '0', x: pt.x, y: pt.y, text: e.text || '' };
        }
        return e;
      });
    },

    async openDxf(url, file, container) {
      container.innerHTML = `
        <div style="width:100%;height:100%;display:flex;gap:12px;">
          <div style="width:210px;background:#1E293B;border-radius:12px;padding:12px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
            <div style="font-weight:700;font-size:12px;text-transform:uppercase;color:#94A3B8;margin-bottom:8px;">CAD Layers</div>
            <div id="dxf-layers" style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;"></div>
            <button type="button" id="dxf-fit" class="btn btn-primary btn-sm btn-full" style="margin-top:14px;">Fit Drawing</button>
          </div>
          <div style="flex:1;position:relative;background:#0B1120;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
            <canvas id="dxf-canvas" style="width:100%;height:100%;display:block;cursor:grab;"></canvas>
          </div>
        </div>
      `;

      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Failed to fetch DXF');
        const text = await res.text();

        let entities = [];
        try {
          const { default: DxfParser } = await import('https://esm.sh/dxf-parser@1.1.2');
          const parser = new DxfParser();
          const parsed = parser.parseSync(text);
          entities = ViewerManager.normalizeDxfEntities(parsed);
        } catch {
          entities = ViewerManager.parseDxfFallback(text);
        }

        const layers = Array.from(new Set(entities.map((e) => e.layer || '0')));
        const hiddenLayers = new Set();

        const layersEl = document.getElementById('dxf-layers');
        layersEl.innerHTML = layers.length
          ? layers
              .map(
                (l) => `
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" checked data-dxf-layer="${App.escapeHtml(l)}">
                <span>${App.escapeHtml(l)}</span>
              </label>`
              )
              .join('')
          : '<span style="color:#64748B">No layers</span>';

        const canvas = document.getElementById('dxf-canvas');
        const ctx = canvas.getContext('2d');

        // Compute bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const addPt = (x, y) => {
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        };
        entities.forEach((e) => {
          if (e.type === 'LINE') { addPt(e.x1, e.y1); addPt(e.x2, e.y2); }
          else if (e.type === 'CIRCLE' || e.type === 'ARC') {
            addPt(e.cx - e.r, e.cy - e.r);
            addPt(e.cx + e.r, e.cy + e.r);
          } else if (e.vertices) {
            e.vertices.forEach((v) => addPt(v.x, v.y));
          } else if (Number.isFinite(e.x) && Number.isFinite(e.y)) {
            addPt(e.x, e.y);
          }
        });
        if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }

        let zoom = 1;
        let panX = 0;
        let panY = 0;

        const fit = () => {
          const w = canvas.clientWidth || 800;
          const h = canvas.clientHeight || 500;
          const dw = Math.max(1e-3, maxX - minX);
          const dh = Math.max(1e-3, maxY - minY);
          zoom = Math.min((w * 0.85) / dw, (h * 0.85) / dh);
          panX = w / 2 - ((minX + maxX) / 2) * zoom;
          panY = h / 2 + ((minY + maxY) / 2) * zoom;
          draw();
        };

        const draw = () => {
          const w = canvas.clientWidth || 800;
          const h = canvas.clientHeight || 500;
          canvas.width = w;
          canvas.height = h;
          ctx.fillStyle = '#0B1120';
          ctx.fillRect(0, 0, w, h);

          ctx.strokeStyle = '#38BDF8';
          ctx.fillStyle = '#E2E8F0';
          ctx.lineWidth = 1.25;

          const toX = (x) => panX + x * zoom;
          const toY = (y) => panY - y * zoom;

          entities.forEach((e) => {
            if (hiddenLayers.has(e.layer || '0')) return;
            ctx.beginPath();
            if (e.type === 'LINE') {
              ctx.moveTo(toX(e.x1), toY(e.y1));
              ctx.lineTo(toX(e.x2), toY(e.y2));
              ctx.stroke();
            } else if (e.type === 'CIRCLE') {
              ctx.arc(toX(e.cx), toY(e.cy), Math.max(1, e.r * zoom), 0, Math.PI * 2);
              ctx.stroke();
            } else if (e.type === 'ARC') {
              ctx.arc(toX(e.cx), toY(e.cy), Math.max(1, e.r * zoom), -e.endAngle, -e.startAngle);
              ctx.stroke();
            } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length) {
              ctx.moveTo(toX(e.vertices[0].x), toY(e.vertices[0].y));
              for (let i = 1; i < e.vertices.length; i++) {
                ctx.lineTo(toX(e.vertices[i].x), toY(e.vertices[i].y));
              }
              if (e.closed) ctx.closePath();
              ctx.stroke();
            } else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text) {
              ctx.font = '12px Inter, sans-serif';
              ctx.fillText(e.text, toX(e.x), toY(e.y));
            }
          });
        };

        layersEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.addEventListener('change', () => {
            if (cb.checked) hiddenLayers.delete(cb.dataset.dxfLayer);
            else hiddenLayers.add(cb.dataset.dxfLayer);
            draw();
          });
        });

        document.getElementById('dxf-fit')?.addEventListener('click', fit);

        let dragging = false, sx = 0, sy = 0;
        canvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          panX = mx - (mx - panX) * f;
          panY = my - (my - panY) * f;
          zoom *= f;
          draw();
        }, { passive: false });
        canvas.addEventListener('mousedown', (e) => {
          dragging = true; sx = e.clientX - panX; sy = e.clientY - panY;
          canvas.style.cursor = 'grabbing';
        });
        const onMove = (e) => {
          if (!dragging) return;
          panX = e.clientX - sx; panY = e.clientY - sy;
          draw();
        };
        const onUp = () => { dragging = false; canvas.style.cursor = 'grab'; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('resize', draw);

        ViewerManager.cleanupFn = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('resize', draw);
        };

        fit();
      } catch (err) {
        container.innerHTML = `
          <div class="viewer-placeholder">
            <span class="viewer-placeholder-badge">DXF 2D CAD Viewer</span>
            <h3>${App.escapeHtml(file.original_name || file.label)}</h3>
            <p>Could not parse DXF drawing (${App.escapeHtml(err.message)}).</p>
            <button type="button" class="btn btn-primary" data-viewer-download>Download DXF</button>
          </div>`;
      }
    },

    /* ---------------- 5. IFC BIM Viewer ---------------- */
    parseIfcSummary(text) {
      const counts = {};
      const regex = /=\s*(IFC[A-Z0-9_]+)\s*\(/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const k = m[1];
        counts[k] = (counts[k] || 0) + 1;
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);
    },

    async openIfc(url, file, container) {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Failed to fetch IFC file');
        const buf = await res.arrayBuffer();
        const textSample = new TextDecoder().decode(buf.slice(0, 262144));
        const summary = ViewerManager.parseIfcSummary(textSample);

        // Attempt Three.js + web-ifc 3D rendering
        try {
          const [THREE, { OrbitControls }, WebIFC] = await Promise.all([
            import('https://esm.sh/three@0.160.0'),
            import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
            import('https://esm.sh/web-ifc@0.0.57'),
          ]);

          const ifcApi = new WebIFC.IfcAPI();
          ifcApi.SetWasmPath('https://esm.sh/web-ifc@0.0.57/');
          await ifcApi.Init();
          const modelID = ifcApi.OpenModel(new Uint8Array(buf));

          container.innerHTML = `
            <div style="width:100%;height:100%;display:flex;gap:12px;">
              <div style="width:240px;background:#1E293B;border-radius:12px;padding:14px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <div style="font-weight:700;font-size:12px;text-transform:uppercase;color:#94A3B8;margin-bottom:10px;">IFC Spatial Summary</div>
                ${summary.map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.06);"><span>${App.escapeHtml(k)}</span><span class="badge">${v}</span></div>`).join('')}
              </div>
              <div id="ifc-mount" style="flex:1;background:#0B1120;border-radius:12px;overflow:hidden;"></div>
            </div>
          `;
          const mount = document.getElementById('ifc-mount');
          const scene = new THREE.Scene();
          scene.background = new THREE.Color(0x0b1120);
          const camera = new THREE.PerspectiveCamera(45, (mount.clientWidth || 800) / (mount.clientHeight || 500), 0.1, 10000);
          const renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 500);
          mount.appendChild(renderer.domElement);
          const controls = new OrbitControls(camera, renderer.domElement);
          scene.add(new THREE.AmbientLight(0xffffff, 0.7));
          const dir = new THREE.DirectionalLight(0xffffff, 1);
          dir.position.set(15, 25, 15);
          scene.add(dir);
          scene.add(new THREE.GridHelper(30, 30, 0x0284c7, 0x1e293b));

          const group = new THREE.Group();
          ifcApi.StreamAllMeshes(modelID, (mesh) => {
            for (let i = 0; i < mesh.geometries.size(); i++) {
              const pg = mesh.geometries.get(i);
              const geom = ifcApi.GetGeometry(modelID, pg.geometryExpressID);
              const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
              const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
              const bGeom = new THREE.BufferGeometry();
              const pos = new Float32Array(verts.length / 2);
              const norm = new Float32Array(verts.length / 2);
              for (let j = 0; j < verts.length; j += 6) {
                const idx = j / 2;
                pos[idx] = verts[j]; pos[idx + 1] = verts[j + 1]; pos[idx + 2] = verts[j + 2];
                norm[idx] = verts[j + 3]; norm[idx + 1] = verts[j + 4]; norm[idx + 2] = verts[j + 5];
              }
              bGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
              bGeom.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
              bGeom.setIndex(Array.from(indices));
              const col = pg.color;
              const mat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(col.x, col.y, col.z),
                opacity: col.w,
                transparent: col.w < 1,
              });
              const m = new THREE.Mesh(bGeom, mat);
              m.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
              group.add(m);
              geom.delete();
            }
          });
          scene.add(group);
          const box = new THREE.Box3().setFromObject(group);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const d = Math.max(size.x, size.y, size.z) || 10;
          camera.position.set(center.x + d * 1.5, center.y + d, center.z + d * 1.5);
          controls.target.copy(center);
          controls.update();

          let raf = 0;
          const anim = () => { raf = requestAnimationFrame(anim); controls.update(); renderer.render(scene, camera); };
          anim();
          ViewerManager.cleanupFn = () => {
            cancelAnimationFrame(raf);
            controls.dispose();
            renderer.dispose();
            ifcApi.CloseModel(modelID);
          };
          return;
        } catch {
          // Fallback to STEP spatial tree inspector when web-ifc WASM is unavailable
          container.innerHTML = `
            <div class="viewer-placeholder" style="text-align:left;max-width:620px;">
              <div style="text-align:center;">
                <span class="viewer-placeholder-badge">IFC BIM Inspector</span>
                <h3>${App.escapeHtml(file.original_name || file.label)}</h3>
                <p>IFC 3D WebAssembly engine could not initialize; showing parsed STEP BIM elements.</p>
              </div>
              <div style="margin:16px 0;max-height:220px;overflow-y:auto;background:rgba(15,23,42,0.7);border-radius:10px;padding:12px;border:1px solid rgba(255,255,255,0.08);">
                ${
                  summary.length
                    ? summary
                        .map(
                          ([k, v]) =>
                            `<div style="display:flex;justify-content:space-between;padding:5px 4px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12.5px;"><span>${App.escapeHtml(k)}</span><span class="badge">${v}</span></div>`
                        )
                        .join('')
                    : '<div style="color:#94A3B8;font-size:12.5px;">No STEP entities detected in preview header.</div>'
                }
              </div>
              <div style="text-align:center;">
                <button type="button" class="btn btn-primary" data-viewer-download>Download IFC</button>
              </div>
            </div>
          `;
        }
      } catch (err) {
        ViewerManager.openGeneric(file, container);
      }
    },

    /* ---------------- 6. Proprietary CAD/BIM Inspector ---------------- */
    openProprietaryCad(ext, file, container) {
      const infoMap = {
        skp: { name: 'SketchUp 3D Model', guide: 'Export as .glb / .gltf or .obj in SketchUp (File → Export → 3D Model) for interactive browser 3D viewing.' },
        skb: { name: 'SketchUp Backup (.skb)', guide: 'Auto-saved SketchUp backup file. Rename .skb to .skp to open in SketchUp, or export to .glb/.ifc for web viewing.' },
        dwg: { name: 'AutoCAD DWG Drawing', guide: 'Save As / Export to ASCII .dxf in AutoCAD or ODA File Converter for instant 2D CAD browser rendering.' },
        bak: { name: 'AutoCAD Drawing Backup (.bak)', guide: 'AutoCAD backup of a .dwg file (identical format). Rename .bak to .dwg to open in AutoCAD, or export .dxf for browser CAD viewing.' },
        rvt: { name: 'Autodesk Revit Project', guide: 'Export to .ifc (Building Information Model) or .glb via Datasmith/glTF exporter for 3D web inspection.' },
        rfa: { name: 'Autodesk Revit Family', guide: 'Export family geometry to .ifc or .obj/.glb to preview directly in ArcSite.' },
        '3dm': { name: 'Rhinoceros 3D Model', guide: 'Export as .glb/.obj for interactive 3D mesh viewing, or .dxf for 2D vector plans.' },
        fbx: { name: 'Autodesk FBX 3D Asset', guide: 'Convert to .glb/.gltf (e.g., via Blender or FBX2glTF) for zero-plugin 3D browser preview.' },
      };
      const meta = infoMap[ext] || { name: ext.toUpperCase() + ' CAD File', guide: 'Export to .glb, .dxf, or .pdf for in-browser preview.' };

      const thumbHtml = file.thumbnail_url
        ? `<img class="viewer-cad-thumb" src="${App.escapeHtml(file.thumbnail_url)}" alt="Model Preview">`
        : '';

      let extraMetaHtml = '';
      if (file.metadata && typeof file.metadata === 'object') {
        extraMetaHtml = Object.entries(file.metadata)
          .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
          .map(
            ([k, v]) =>
              `<div class="viewer-meta-row"><span>${App.escapeHtml(k)}</span><span>${App.escapeHtml(String(v))}</span></div>`
          )
          .join('');
      }

      container.innerHTML = `
        <div class="viewer-placeholder" style="max-width:600px;text-align:left;">
          <div style="text-align:center;">
            <span class="viewer-placeholder-badge">${App.escapeHtml(meta.name)}</span>
            <h3>${App.escapeHtml(file.original_name || file.label)}</h3>
          </div>
          ${thumbHtml}
          <div class="viewer-meta-rows">
            <div class="viewer-meta-row"><span>Format</span><span>.${App.escapeHtml(ext)}</span></div>
            <div class="viewer-meta-row"><span>Size</span><span>${App.escapeHtml(App.formatBytes(file.file_size))}</span></div>
            <div class="viewer-meta-row"><span>Uploaded</span><span>${App.escapeHtml(App.formatDate(file.created_at))}</span></div>
            ${extraMetaHtml}
          </div>
          <div style="background:rgba(217, 119, 6, 0.12);border:1px solid rgba(217, 119, 6, 0.35);border-radius:8px;padding:12px 14px;font-size:12.5px;color:#CBD5E1;margin-bottom:18px;">
            <strong style="color:#fff;">Web Viewing Tip:</strong> ${App.escapeHtml(meta.guide)}
          </div>
          <div style="text-align:center;">
            <button type="button" class="btn btn-primary" data-viewer-download>Download ${App.escapeHtml(ext.toUpperCase())} File</button>
          </div>
        </div>
      `;
    },

    /* ---------------- 6b. PowerPoint Presentation Inspector ---------------- */
    openPptx(file, container) {
      const m = file.metadata || {};
      const slides = Array.isArray(m.slides) ? m.slides : [];
      const thumbHtml = file.thumbnail_url
        ? `<img class="viewer-cad-thumb" src="${App.escapeHtml(file.thumbnail_url)}" alt="Presentation Cover">`
        : '';

      const slidesHtml = slides.length
        ? `<div class="viewer-pptx-slides">${slides
            .map(
              (s) => `
              <div class="viewer-pptx-slide">
                <div class="viewer-pptx-slide-title">Slide ${App.escapeHtml(String(s.slide))}: ${App.escapeHtml(s.title)}</div>
                ${
                  Array.isArray(s.snippets) && s.snippets.length
                    ? `<div class="viewer-pptx-slide-snippets">${s.snippets.map((t) => App.escapeHtml(t)).join(' • ')}</div>`
                    : ''
                }
              </div>`
            )
            .join('')}</div>`
        : '<p style="margin:12px 0;">Download the PowerPoint file to view full slide transitions and layouts.</p>';

      container.innerHTML = `
        <div class="viewer-placeholder" style="max-width:640px;text-align:left;">
          <div style="text-align:center;">
            <span class="viewer-placeholder-badge">Presentation Deck (${App.escapeHtml(String(m.slide_count || slides.length || '?'))} Slides)</span>
            <h3>${App.escapeHtml(file.original_name || file.label)}</h3>
          </div>
          ${thumbHtml}
          <div class="viewer-meta-rows" style="margin:10px 0;">
            <div class="viewer-meta-row"><span>Size</span><span>${App.escapeHtml(App.formatBytes(file.file_size))}</span></div>
            <div class="viewer-meta-row"><span>Uploaded</span><span>${App.escapeHtml(App.formatDate(file.created_at))}</span></div>
          </div>
          ${slidesHtml}
          <div style="text-align:center;">
            <button type="button" class="btn btn-primary" data-viewer-download>Download PPTX Deck</button>
          </div>
        </div>
      `;
    },

    /* ---------------- 7. Text / HTML / Generic ---------------- */
    async openText(url, container) {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        const text = await res.text();
        container.innerHTML = `<pre style="width:100%;max-width:960px;max-height:100%;overflow:auto;background:#1E293B;color:#E2E8F0;padding:24px;border-radius:12px;font-size:13px;line-height:1.6;">${App.escapeHtml(text)}</pre>`;
      } catch (err) {
        ViewerManager.openGeneric(ViewerManager.file, container);
      }
    },

    openHtml(url, container) {
      container.innerHTML = `<iframe class="viewer-iframe" sandbox="allow-same-origin" src="${App.escapeHtml(url)}"></iframe>`;
    },

    openGeneric(file, container) {
      container.innerHTML = `
        <div class="viewer-meta-card">
          <h3>${App.escapeHtml(file.original_name || file.label || 'File')}</h3>
          <div class="viewer-meta-rows">
            <div class="viewer-meta-row"><span>Type</span><span>${App.escapeHtml(file.mime_type || file.file_type || 'Unknown')}</span></div>
            <div class="viewer-meta-row"><span>Size</span><span>${App.escapeHtml(App.formatBytes(file.file_size))}</span></div>
            <div class="viewer-meta-row"><span>Uploaded</span><span>${App.escapeHtml(App.formatDate(file.created_at))}</span></div>
          </div>
          <button type="button" class="btn btn-primary btn-full" data-viewer-download>Download File</button>
        </div>
      `;
    },
  };

  window.ViewerManager = ViewerManager;
})();
