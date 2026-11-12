/* ==========================================================================
   ArcSite Navigator — Project Workspace Controller
   ========================================================================== */

(function () {
  'use strict';

  const CATEGORIES = [
    'Site Plan',
    'Views & 3D',
    'Working CAD',
    'Presentations',
    'References',
    'Architecture',
    'Structural',
    'MEP',
    'General',
  ];
  const IGNORED_OS_FILES = new Set(['thumbs.db', '.ds_store', 'desktop.ini', '__macosx']);

  const ProjectController = {
    project: null,
    assets: [],
    files: [],
    selectedAssetId: null,
    editMode: false,
    searchQuery: '',
    sidebarTab: 'assets', // 'assets' | 'files'
    fileCategoryFilter: 'All',
    precreatedCategories: {},
    pendingFiles: [],
    pendingPolygon: null,
    uploadTargetAssetId: null,
    dragState: null,
    vertexDrag: null,
    presentMode: false,
    magicTraceActive: false,
    magicTraceBusy: false,
    magicTraceTargetAssetId: null,
    _cachedPdfVectors: null,
    smartAssistOpen: false,
    smartSuggestions: [],
    smartSiteArea: '',
    polyDraw: {
      active: false,
      points: [],
      editingAssetId: null,
      ortho: false,
      currentMouse: null,
      snapped: false,
    },
    cadMenuTarget: null,

    init() {
      document.getElementById('back-to-dash')?.addEventListener('click', () => {
        App.navigate('#/dashboard');
      });

      // Editable project title
      const titleEl = document.getElementById('proj-title');
      if (titleEl) {
        titleEl.addEventListener('click', () => {
          if (titleEl.getAttribute('contenteditable') !== 'true') {
            titleEl.setAttribute('contenteditable', 'true');
            titleEl.focus();
            const range = document.createRange();
            range.selectNodeContents(titleEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        });
        titleEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            titleEl.blur();
          } else if (e.key === 'Escape') {
            titleEl.textContent = ProjectController.project?.name || '';
            titleEl.setAttribute('contenteditable', 'false');
          }
        });
        titleEl.addEventListener('blur', () => {
          titleEl.setAttribute('contenteditable', 'false');
          ProjectController.saveProjectTitle(titleEl.textContent.trim());
        });
      }

      // Edit mode toggle
      const editCb = document.getElementById('edit-mode-cb');
      if (editCb) {
        editCb.addEventListener('change', (e) => {
          ProjectController.setEditMode(e.target.checked);
        });
      }

      // Sidebar tabs, search & mobile toggle
      document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ProjectController.setSidebarTab(btn.dataset.sidebarTab);
        });
      });
      document.getElementById('asset-search')?.addEventListener('input', (e) => {
        ProjectController.searchQuery = e.target.value.trim().toLowerCase();
        ProjectController.renderSidebar();
      });
      document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.getElementById('proj-sidebar')?.classList.toggle('open');
      });

      // Import whole project folder
      const folderInput = document.getElementById('folder-upload-input');
      document.getElementById('import-folder-btn')?.addEventListener('click', () => {
        if (folderInput) folderInput.click();
      });
      folderInput?.addEventListener('change', async () => {
        if (folderInput.files && folderInput.files.length > 0) {
          await ProjectController.importFolderFiles(Array.from(folderInput.files));
          folderInput.value = '';
        }
      });

      // Upload project-wide files button (in Files tab footer)
      document.getElementById('upload-project-files-btn')?.addEventListener('click', () => {
        ProjectController.openUploadModal(null);
      });

      // Export JSON
      document.getElementById('export-json-btn')?.addEventListener('click', () => {
        ProjectController.exportJson();
      });

      // Upload Map Modal
      document.getElementById('upload-map-btn')?.addEventListener('click', () => {
        document.getElementById('map-upload-error').textContent = '';
        document.getElementById('upload-map-modal').hidden = false;
      });
      ProjectController.bindMapUpload();

      // Add Asset Modal
      document.getElementById('add-asset-btn')?.addEventListener('click', () => {
        ProjectController.openAddAssetModal();
      });
      ProjectController.bindAddAssetModal();

      // Editor Panel
      ProjectController.bindEditorPanel();

      // Document Popup
      document.getElementById('doc-popup-close')?.addEventListener('click', () => {
        document.getElementById('doc-popup').hidden = true;
      });
      document.getElementById('doc-popup-upload')?.addEventListener('click', () => {
        if (ProjectController.selectedAssetId) {
          ProjectController.openUploadModal(ProjectController.selectedAssetId);
        }
      });
      document.getElementById('doc-popup-delete')?.addEventListener('click', () => {
        if (ProjectController.selectedAssetId) {
          ProjectController.deleteAssetById(ProjectController.selectedAssetId);
        }
      });
      document.getElementById('doc-popup-align')?.addEventListener('click', () => {
        if (ProjectController.selectedAssetId) {
          document.getElementById('doc-popup').hidden = true;
          ProjectController.startMagicTrace(ProjectController.selectedAssetId);
        }
      });

      // CAD & Architecture Keyboard Shortcuts + Shortcuts Help Modal
      document.getElementById('shortcuts-help-btn')?.addEventListener('click', () => {
        const modal = document.getElementById('shortcuts-modal');
        if (modal) modal.hidden = !modal.hidden;
      });
      ProjectController.bindKeyboardShortcuts();

      // File Upload Modal
      ProjectController.bindFileUploadModal();

      // Global drag/resize listeners for hotspots
      window.addEventListener('mousemove', (e) => ProjectController.onPointerMove(e));
      window.addEventListener('mouseup', () => ProjectController.onPointerUp());
      window.addEventListener('touchmove', (e) => ProjectController.onPointerMove(e), { passive: false });
      window.addEventListener('touchend', () => ProjectController.onPointerUp());

      // Polygon Drawing & Magic Trace
      ProjectController.bindPolygonDrawing();
      ProjectController.bindCadGripMenu();
      ProjectController.bindMagicTrace();
      document.getElementById('toggle-labels-btn')?.addEventListener('click', () => {
        const mapArea = document.getElementById('map-area');
        const btn = document.getElementById('toggle-labels-btn');
        if (!mapArea) return;
        const faded = mapArea.classList.toggle('map-hide-labels');
        btn?.classList.toggle('btn-primary', faded);
        btn?.classList.toggle('btn-ghost', !faded);
      });

      // Smart Assist, Schedule, Gallery, Presentation Mode
      ProjectController.bindSmartAssist();
      document.getElementById('schedule-btn')?.addEventListener('click', () => ProjectController.openScheduleModal());
      document.getElementById('present-schedule-btn')?.addEventListener('click', () => ProjectController.openScheduleModal());
      document.getElementById('gallery-btn')?.addEventListener('click', () => ProjectController.openGalleryModal());
      document.getElementById('present-gallery-btn')?.addEventListener('click', () => ProjectController.openGalleryModal());
      document.getElementById('present-mode-btn')?.addEventListener('click', () => ProjectController.setPresentationMode(true));
      document.getElementById('exit-present-btn')?.addEventListener('click', () => ProjectController.setPresentationMode(false));
    },

    async load(projectId) {
      App.updateUserAvatars();
      ProjectController.selectedAssetId = null;
      ProjectController.pendingPolygon = null;
      ProjectController._cachedPdfVectors = null;
      window.SlimSamSegmenter?.clearCache();
      ProjectController.cancelPolygonDraw();
      ProjectController.cancelMagicTrace();
      ProjectController.setPresentationMode(false);
      ProjectController.closeSmartAssist();
      ProjectController.setEditMode(false);
      document.getElementById('doc-popup').hidden = true;
      document.getElementById('editor-panel').hidden = true;
      document.getElementById('proj-sidebar')?.classList.remove('open');

      try {
        const [projRes, assetsRes, filesRes] = await Promise.all([
          App.api(`/api/projects/${encodeURIComponent(projectId)}`),
          App.api(`/api/projects/${encodeURIComponent(projectId)}/assets`),
          App.api(`/api/projects/${encodeURIComponent(projectId)}/files`),
        ]);

        ProjectController.project = projRes.project;
        ProjectController.assets = assetsRes.assets || [];
        ProjectController.files = filesRes.files || [];

        document.getElementById('proj-title').textContent = ProjectController.project.name || 'Untitled Project';
        ProjectController.updateMapImage();

        if (window.MapController) {
          window.MapController.fit();
        }

        ProjectController.renderSidebar();
        ProjectController.renderHotspots();
      } catch (err) {
        App.toast(err.message || 'Failed to load project', 'error');
        App.navigate('#/dashboard');
      }
    },

    updateMapImage() {
      window.SlimSamSegmenter?.clearCache();
      const img = document.getElementById('map-image');
      if (!img || !ProjectController.project) return;

      const fallback = '/assets/site-map.svg';
      if (ProjectController.project.map_path) {
        img.onerror = () => {
          img.onerror = null;
          img.src = fallback;
        };
        img.src = `/api/projects/${encodeURIComponent(ProjectController.project.id)}/map?t=${Date.now()}`;
      } else {
        img.onerror = null;
        img.src = fallback;
      }
    },

    async saveProjectTitle(newName) {
      if (!ProjectController.project) return;
      if (!newName || newName === ProjectController.project.name) {
        document.getElementById('proj-title').textContent = ProjectController.project.name;
        return;
      }
      try {
        await App.api(`/api/projects/${encodeURIComponent(ProjectController.project.id)}`, {
          method: 'PUT',
          body: {
            name: newName,
            description: ProjectController.project.description || '',
          },
        });
        ProjectController.project.name = newName;
        App.toast('Project name updated', 'success');
      } catch (err) {
        document.getElementById('proj-title').textContent = ProjectController.project.name;
        App.toast(err.message || 'Failed to update name', 'error');
      }
    },

    setEditMode(enabled) {
      ProjectController.editMode = !!enabled;
      const cb = document.getElementById('edit-mode-cb');
      const pill = document.getElementById('edit-mode-toggle');
      const mapArea = document.getElementById('map-area');
      if (cb) cb.checked = ProjectController.editMode;
      if (pill) pill.classList.toggle('active', ProjectController.editMode);
      if (mapArea) mapArea.classList.toggle('edit-mode', ProjectController.editMode);

      if (ProjectController.editMode) {
        document.getElementById('doc-popup').hidden = true;
        if (ProjectController.selectedAssetId) {
          ProjectController.openEditor(ProjectController.selectedAssetId);
        }
      } else {
        document.getElementById('editor-panel').hidden = true;
      }
    },

    setSidebarTab(tab) {
      ProjectController.sidebarTab = tab === 'files' ? 'files' : 'assets';
      document.querySelectorAll('[data-sidebar-tab]').forEach((b) => {
        b.classList.toggle('active', b.dataset.sidebarTab === ProjectController.sidebarTab);
      });
      const addAssetBtn = document.getElementById('add-asset-btn');
      const uploadFilesBtn = document.getElementById('upload-project-files-btn');
      if (addAssetBtn) addAssetBtn.hidden = ProjectController.sidebarTab !== 'assets';
      if (uploadFilesBtn) uploadFilesBtn.hidden = ProjectController.sidebarTab !== 'files';
      ProjectController.renderSidebar();
    },

    renderProjectFilesSidebar() {
      const filesListEl = document.getElementById('project-files-list');
      const pillsEl = document.getElementById('file-cat-pills');
      if (!filesListEl || !pillsEl) return;

      const presentCats = Array.from(
        new Set(ProjectController.files.map((f) => f.category || 'General'))
      );
      const pillCats = ['All', ...CATEGORIES.filter((c) => presentCats.includes(c))];
      presentCats.forEach((c) => {
        if (!pillCats.includes(c)) pillCats.push(c);
      });
      if (!pillCats.includes(ProjectController.fileCategoryFilter)) {
        ProjectController.fileCategoryFilter = 'All';
      }

      pillsEl.innerHTML = pillCats
        .map(
          (cat) => `
          <button type="button" class="file-cat-pill${ProjectController.fileCategoryFilter === cat ? ' active' : ''}" data-file-cat="${App.escapeHtml(cat)}">
            ${App.escapeHtml(cat)}
          </button>`
        )
        .join('');

      pillsEl.querySelectorAll('[data-file-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ProjectController.fileCategoryFilter = btn.dataset.fileCat;
          ProjectController.renderProjectFilesSidebar();
        });
      });

      const q = ProjectController.searchQuery;
      const filtered = ProjectController.files.filter((f) => {
        const catMatch =
          ProjectController.fileCategoryFilter === 'All' ||
          (f.category || 'General') === ProjectController.fileCategoryFilter;
        const text = `${f.label || ''} ${f.original_name || ''} ${f.category || ''} ${f.metadata?.folder || ''}`.toLowerCase();
        return catMatch && (!q || text.includes(q));
      });

      if (filtered.length === 0) {
        filesListEl.innerHTML = `<div class="doc-empty">${
          ProjectController.files.length === 0
            ? 'No project files yet. Use "Import Folder" or "Upload Project Files".'
            : 'No files match this filter.'
        }</div>`;
        return;
      }

      const assetOptionsHtml = (selectedId) =>
        `<option value="">Project-wide (Unassigned)</option>` +
        ProjectController.assets
          .map(
            (a) =>
              `<option value="${App.escapeHtml(a.id)}"${a.id === selectedId ? ' selected' : ''}>${App.escapeHtml(a.icon || '🏢')} ${App.escapeHtml(a.title)}</option>`
          )
          .join('');

      filesListEl.innerHTML = filtered
        .map((f) => {
          const ext = ((f.original_name || '').split('.').pop() || '').toLowerCase();
          const isBackup = !!(f.metadata && f.metadata.is_backup) || ext === 'skb' || ext === 'bak';
          const canBeMap = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'tif', 'tiff', 'bmp'].includes(ext);
          const thumbHtml = f.thumbnail_url
            ? `<img src="${App.escapeHtml(f.thumbnail_url)}" alt="" loading="lazy">`
            : `<span>${ProjectController.getFileIcon(f)}</span>`;

          return `
            <div class="proj-file-card" data-pfile-id="${App.escapeHtml(f.id)}">
              <div class="proj-file-top" data-open-file="${App.escapeHtml(f.id)}">
                <div class="proj-file-thumb">${thumbHtml}</div>
                <div class="proj-file-info">
                  <div class="proj-file-name" title="${App.escapeHtml(f.original_name)}">${App.escapeHtml(f.label || f.original_name)}</div>
                  <div class="proj-file-meta">
                    <span class="file-badge-cat">${App.escapeHtml(f.category || 'General')}</span>
                    <span class="status-pill status-${App.escapeHtml(f.status || 'WIP')}">${App.escapeHtml(f.status || 'WIP')}</span>
                    ${isBackup ? '<span class="file-badge-backup">BACKUP</span>' : ''}
                    <span>${App.escapeHtml(App.formatBytes(f.file_size))}</span>
                  </div>
                </div>
              </div>
              <div class="proj-file-actions">
                <select class="file-assign-select" data-assign-file="${App.escapeHtml(f.id)}" title="Assign to Site Map Asset">
                  ${assetOptionsHtml(f.asset_id)}
                </select>
                <select class="file-assign-select" style="flex:0 0 74px;" data-status-file="${App.escapeHtml(f.id)}" title="Approval Status">
                  <option value="WIP"${(f.status || 'WIP') === 'WIP' ? ' selected' : ''}>WIP</option>
                  <option value="Review"${f.status === 'Review' ? ' selected' : ''}>Review</option>
                  <option value="Approved"${f.status === 'Approved' ? ' selected' : ''}>Approved</option>
                </select>
                ${
                  canBeMap
                    ? `<button type="button" class="btn btn-ghost btn-xs" data-set-map="${App.escapeHtml(f.id)}" title="Use as Site Map">Map</button>`
                    : ''
                }
                <button type="button" class="btn btn-ghost btn-xs" data-del-pfile="${App.escapeHtml(f.id)}" title="Delete file" style="color:var(--danger);">&times;</button>
              </div>
            </div>
          `;
        })
        .join('');

      filesListEl.querySelectorAll('[data-open-file]').forEach((el) => {
        el.addEventListener('click', () => {
          const file = ProjectController.files.find((x) => x.id === el.dataset.openFile);
          if (file && window.ViewerManager) {
            window.ViewerManager.open(ProjectController.project.id, file);
          }
        });
      });

      filesListEl.querySelectorAll('[data-assign-file]').forEach((sel) => {
        sel.addEventListener('change', () => {
          ProjectController.assignFileToAsset(sel.dataset.assignFile, sel.value || null);
        });
      });

      filesListEl.querySelectorAll('[data-status-file]').forEach((sel) => {
        sel.addEventListener('change', () => {
          ProjectController.updateFileStatus(sel.dataset.statusFile, sel.value);
        });
      });

      filesListEl.querySelectorAll('[data-set-map]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ProjectController.setExistingFileAsMap(btn.dataset.setMap);
        });
      });

      filesListEl.querySelectorAll('[data-del-pfile]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ProjectController.deleteFile(btn.dataset.delPfile);
        });
      });
    },

    async updateFileStatus(fileId, status) {
      try {
        const res = await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/${encodeURIComponent(fileId)}`,
          { method: 'PATCH', body: { status } }
        );
        if (res && res.file) {
          const idx = ProjectController.files.findIndex((f) => f.id === fileId);
          if (idx >= 0) ProjectController.files[idx] = res.file;
          ProjectController.renderSidebar();
          App.toast(`Status updated to ${status}`, 'success');
        }
      } catch (err) {
        App.toast(err.message || 'Failed to update status', 'error');
      }
    },

    async assignFileToAsset(fileId, assetId) {
      try {
        const res = await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/${encodeURIComponent(fileId)}`,
          {
            method: 'PATCH',
            body: { asset_id: assetId },
          }
        );
        if (res && res.file) {
          const idx = ProjectController.files.findIndex((f) => f.id === fileId);
          if (idx >= 0) ProjectController.files[idx] = res.file;
          ProjectController.renderSidebar();
          App.toast(assetId ? 'File linked to asset' : 'File moved to project-wide', 'success');
        }
      } catch (err) {
        App.toast(err.message || 'Failed to update file assignment', 'error');
      }
    },

    async setExistingFileAsMap(fileId) {
      const file = ProjectController.files.find((f) => f.id === fileId);
      if (!file) return;
      try {
        App.toast('Preparing site map…', 'info');
        const res = await fetch(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/${encodeURIComponent(fileId)}/download?inline=1`,
          { credentials: 'same-origin' }
        );
        if (!res.ok) throw new Error('Failed to fetch file');
        const blob = await res.blob();
        const fObj = new File([blob], file.original_name || 'site-map.png', { type: blob.type });
        await ProjectController.uploadMapFile(fObj, { skipSaveToFiles: true });
      } catch (err) {
        App.toast(err.message || 'Failed to set site map', 'error');
      }
    },

    async renderPdfFirstPageToPng(file) {
      const pdfjsLib = await window.ViewerManager.loadPdfJs();
      const buf = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await pdfDoc.getPage(1);
      const baseVp = page.getViewport({ scale: 1 });
      const targetMax = 3200;
      const scale = Math.min(3.0, Math.max(1.5, targetMax / Math.max(baseVp.width, baseVp.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!pngBlob) throw new Error('Failed to render PDF site plan');
      return new File([pngBlob], file.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' });
    },

    async importFolderFiles(rawFiles) {
      if (!ProjectController.project) return;
      const validFiles = rawFiles.filter((f) => {
        const base = (f.name || '').toLowerCase();
        return base && !IGNORED_OS_FILES.has(base) && !base.startsWith('~$');
      });
      if (validFiles.length === 0) {
        App.toast('No supported files found in folder.', 'error');
        return;
      }

      App.toast(`Importing ${validFiles.length} architectural files…`, 'info');
      let uploadedTotal = 0;
      let failedChunks = 0;

      // Upload in batches of 10
      for (let i = 0; i < validFiles.length; i += 10) {
        const chunk = validFiles.slice(i, i + 10);
        const fd = new FormData();
        const relPaths = [];
        chunk.forEach((f) => {
          fd.append('files', f);
          relPaths.push(f.webkitRelativePath || f.name);
        });
        fd.append('category', 'auto');
        fd.append('relative_paths', JSON.stringify(relPaths));

        try {
          const res = await App.api(
            `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/upload`,
            { method: 'POST', body: fd }
          );
          if (res && res.files) {
            ProjectController.files.push(...res.files);
            uploadedTotal += res.files.length;
          }
        } catch {
          failedChunks++;
        }
      }

      // Auto-detect site plan candidate (e.g. RSB-ASH-SCH-01-SITE PLAN.pdf)
      const sitePlanCandidate = validFiles.find((f) => /site[\s_-]*plan/i.test(f.name) && /\.(pdf|png|jpe?g|svg|webp|tif?f)$/i.test(f.name));
      if (sitePlanCandidate) {
        try {
          await ProjectController.uploadMapFile(sitePlanCandidate, { skipSaveToFiles: true });
        } catch {
          // Non-fatal if auto map fails
        }
      }

      ProjectController.setSidebarTab('files');
      App.toast(
        failedChunks
          ? `Imported ${uploadedTotal} files (${failedChunks} batch failed)`
          : `Imported ${uploadedTotal} files cleanly!`,
        failedChunks ? 'error' : 'success'
      );
    },

    getAssetFiles(assetId) {
      return ProjectController.files.filter((f) => f.asset_id === assetId);
    },

    renderSidebar() {
      const listEl = document.getElementById('asset-list');
      const filesListEl = document.getElementById('project-files-list');
      const pillsEl = document.getElementById('file-cat-pills');
      const badgeEl = document.getElementById('asset-count-badge');
      const fileBadgeEl = document.getElementById('file-count-badge');
      if (badgeEl) badgeEl.textContent = String(ProjectController.assets.length);
      if (fileBadgeEl) fileBadgeEl.textContent = String(ProjectController.files.length);

      if (ProjectController.sidebarTab === 'files') {
        if (listEl) listEl.hidden = true;
        if (filesListEl) filesListEl.hidden = false;
        if (pillsEl) pillsEl.hidden = false;
        ProjectController.renderProjectFilesSidebar();
        return;
      }

      if (listEl) listEl.hidden = false;
      if (filesListEl) filesListEl.hidden = true;
      if (pillsEl) pillsEl.hidden = true;

      const q = ProjectController.searchQuery;
      const filtered = ProjectController.assets.filter((a) =>
        !q || (a.title || '').toLowerCase().includes(q)
      );

      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="doc-empty">${
          ProjectController.assets.length === 0
            ? 'No assets yet. Click "+ Add Asset" below.'
            : 'No matching assets.'
        }</div>`;
        return;
      }

      listEl.innerHTML = filtered
        .map((a) => {
          const count = ProjectController.getAssetFiles(a.id).length;
          const activeClass = a.id === ProjectController.selectedAssetId ? ' active' : '';
          const st = a.status || 'WIP';
          const areaStr = a.area ? ` • ${App.escapeHtml(a.area)}` : '';
          return `
            <div class="asset-item${activeClass}" data-asset-id="${App.escapeHtml(a.id)}">
              <div class="asset-item-icon">${App.escapeHtml(a.icon || '🏢')}</div>
              <div class="asset-item-info">
                <div class="asset-item-title">${App.escapeHtml(a.title)}</div>
                <div class="asset-item-meta">${count} ${count === 1 ? 'doc' : 'docs'}${areaStr} <span class="status-pill status-${App.escapeHtml(st)}">${App.escapeHtml(st)}</span></div>
              </div>
              <button class="btn btn-ghost btn-xs asset-open-btn" data-open-id="${App.escapeHtml(a.id)}">Open</button>
              <button type="button" class="btn btn-ghost btn-icon btn-xs asset-item-del" data-del-asset="${App.escapeHtml(a.id)}" title="Delete zone from map">&times;</button>
            </div>
          `;
        })
        .join('');

      listEl.querySelectorAll('.asset-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const delBtn = e.target.closest('[data-del-asset]');
          if (delBtn) {
            e.stopPropagation();
            ProjectController.deleteAssetById(delBtn.dataset.delAsset);
            return;
          }
          const id = item.dataset.assetId;
          const openBtn = e.target.closest('.asset-open-btn');
          ProjectController.selectAsset(id, !!openBtn || !ProjectController.editMode);
          if (window.innerWidth <= 900) {
            document.getElementById('proj-sidebar')?.classList.remove('open');
          }
        });
      });
    },

    renderPolygons() {
      const svg = document.getElementById('polygon-layer');
      if (!svg) return;

      const zonesHtml = ProjectController.assets
        .filter((a) => Array.isArray(a.polygon) && a.polygon.length >= 3)
        .map((a) => {
          const pts = a.polygon.map((p) => `${p[0]},${p[1]}`).join(' ');
          const activeClass = a.id === ProjectController.selectedAssetId ? ' active' : '';
          return `<polygon class="poly-zone${activeClass}" data-poly-asset="${App.escapeHtml(a.id)}" points="${App.escapeHtml(pts)}"></polygon>`;
        })
        .join('');

      let vertexHandlesHtml = '';
      let cadGuidesHtml = '';
      if (ProjectController.editMode && ProjectController.selectedAssetId) {
        const sel = ProjectController.assets.find((a) => a.id === ProjectController.selectedAssetId);
        if (sel && Array.isArray(sel.polygon) && sel.polygon.length >= 3) {
          const polyLen = sel.polygon.length;

          // Corner grips (square CAD boxes ■)
          const cornerGrips = sel.polygon
            .map((p, vi) => {
              const isActive =
                ProjectController.vertexDrag &&
                ProjectController.vertexDrag.assetId === sel.id &&
                ProjectController.vertexDrag.idx === vi;
              const cls = `poly-vertex-handle cad-grip-vertex${isActive ? ' active' : ''}`;
              return `<rect class="${cls}" data-v-asset="${App.escapeHtml(sel.id)}" data-v-idx="${vi}" x="${(p[0] - 0.75).toFixed(2)}" y="${(p[1] - 0.75).toFixed(2)}" width="1.5" height="1.5"></rect>`;
            })
            .join('');

          // Edge midpoint grips (horizontal CAD pills ▬)
          const edgeGrips = sel.polygon
            .map((p, vi) => {
              const nextP = sel.polygon[(vi + 1) % polyLen];
              const midX = (p[0] + nextP[0]) / 2;
              const midY = (p[1] + nextP[1]) / 2;
              return `<rect class="poly-edge-handle cad-grip-edge" data-e-asset="${App.escapeHtml(sel.id)}" data-e-idx="${vi}" x="${(midX - 1.1).toFixed(2)}" y="${(midY - 0.5).toFixed(2)}" width="2.2" height="1.0" rx="0.25"></rect>`;
            })
            .join('');

          vertexHandlesHtml = cornerGrips + edgeGrips;

          // Orthogonal dimension guidelines when dragging active grip
          if (ProjectController.vertexDrag && ProjectController.vertexDrag.assetId === sel.id) {
            const vi = ProjectController.vertexDrag.idx;
            const cur = sel.polygon[vi];
            const prev = sel.polygon[(vi - 1 + polyLen) % polyLen];
            const dxPrev = (Math.abs(cur[0] - prev[0]) * 35.2).toFixed(1);
            const dyPrev = (Math.abs(cur[1] - prev[1]) * 35.2).toFixed(1);

            cadGuidesHtml = `
              <g class="cad-guides-group">
                <line class="cad-dim-guide" x1="${prev[0]}" y1="${cur[1]}" x2="${cur[0]}" y2="${cur[1]}"></line>
                <line class="cad-dim-guide" x1="${prev[0]}" y1="${prev[1]}" x2="${prev[0]}" y2="${cur[1]}"></line>
                <text class="cad-dim-guide-label" x="${((prev[0] + cur[0]) / 2).toFixed(2)}" y="${(cur[1] - 0.8).toFixed(2)}">${dxPrev}</text>
                <text class="cad-dim-guide-label" x="${(prev[0] + 1.2).toFixed(2)}" y="${((prev[1] + cur[1]) / 2).toFixed(2)}">${dyPrev}</text>
              </g>
            `;
          }
        }
      }

      let saPreviewHtml = '';
      if (ProjectController.smartAssistOpen && ProjectController.smartSuggestions.length > 0) {
        saPreviewHtml = ProjectController.smartSuggestions
          .filter((s) => s.selected && Array.isArray(s.polygon) && s.polygon.length >= 3)
          .map((s) => {
            const pts = s.polygon.map((p) => `${p[0]},${p[1]}`).join(' ');
            return `<polygon class="poly-draft-line" points="${App.escapeHtml(pts)}"></polygon>`;
          })
          .join('');
      }

      let draftHtml = '';
      if (ProjectController.polyDraw.active && ProjectController.polyDraw.points.length > 0) {
        const pts = ProjectController.polyDraw.points;
        const ptsStr = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
        draftHtml += `<polyline class="poly-draft-line" points="${App.escapeHtml(ptsStr)}"></polyline>`;

        // Placed vertices with square CAD grips
        pts.forEach((p, idx) => {
          const isStart = idx === 0;
          const fill = isStart ? '#10B981' : '#0F172A';
          const stroke = isStart ? '#FFFFFF' : '#38BDF8';
          draftHtml += `<rect class="cad-grip-vertex" x="${(p[0] - 0.75).toFixed(2)}" y="${(p[1] - 0.75).toFixed(2)}" width="1.5" height="1.5" style="fill: ${fill}; stroke: ${stroke}; stroke-width: 1.5; vector-effect: non-scaling-stroke;"></rect>`;
        });

        // Live rubber-band line to current mouse position
        if (ProjectController.polyDraw.currentMouse) {
          const last = pts[pts.length - 1];
          const cur = ProjectController.polyDraw.currentMouse;
          draftHtml += `<line class="cad-rubber-band" x1="${last[0]}" y1="${last[1]}" x2="${cur[0]}" y2="${cur[1]}" style="stroke: #38BDF8; stroke-width: 1.8; stroke-dasharray: 2 2; vector-effect: non-scaling-stroke;"></line>`;

          // Dashed closure line back to starting vertex if 2 or more points
          if (pts.length >= 2) {
            const start = pts[0];
            const isSnap = ProjectController.polyDraw.snapped;
            const closeColor = isSnap ? '#10B981' : 'rgba(56, 189, 248, 0.45)';
            const closeWidth = isSnap ? '2.5' : '1.2';
            draftHtml += `<line class="cad-closure-guide" x1="${cur[0]}" y1="${cur[1]}" x2="${start[0]}" y2="${start[1]}" style="stroke: ${closeColor}; stroke-width: ${closeWidth}; stroke-dasharray: 2 2; vector-effect: non-scaling-stroke;"></line>`;
          }
        }
      }

      svg.innerHTML = zonesHtml + saPreviewHtml + cadGuidesHtml + vertexHandlesHtml + draftHtml;

      svg.querySelectorAll('[data-poly-asset]').forEach((poly) => {
        poly.addEventListener('click', (e) => {
          if (ProjectController.polyDraw.active || ProjectController.magicTraceActive) return;
          e.stopPropagation();
          const aid = poly.dataset.polyAsset;
          if (ProjectController.editMode && ProjectController.selectedAssetId === aid) {
            const transformEl = document.getElementById('map-transform');
            const rect = transformEl?.getBoundingClientRect();
            if (rect && rect.width && rect.height) {
              const xPct = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)) * 100) / 100;
              const yPct = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)) * 100) / 100;
              ProjectController.insertPolygonVertexAt(aid, xPct, yPct);
              return;
            }
          }
          const hs = document.querySelector(`.hotspot[data-asset-id="${CSS.escape(aid)}"]`);
          ProjectController.selectAsset(aid, !ProjectController.editMode, hs);
        });
      });

      svg.querySelectorAll('.poly-vertex-handle').forEach((vh) => {
        vh.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || !ProjectController.editMode) return;
          e.stopPropagation();
          e.preventDefault();
          ProjectController.vertexDrag = {
            assetId: vh.dataset.vAsset,
            idx: Number(vh.dataset.vIdx),
            moved: false,
          };
        });
        vh.addEventListener('contextmenu', (e) => {
          if (!ProjectController.editMode) return;
          e.preventDefault();
          e.stopPropagation();
          ProjectController.openCadGripMenu(e, vh.dataset.vAsset, Number(vh.dataset.vIdx), false);
        });
      });

      svg.querySelectorAll('.poly-edge-handle').forEach((eh) => {
        eh.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || !ProjectController.editMode) return;
          e.stopPropagation();
          e.preventDefault();
          const assetId = eh.dataset.eAsset;
          const idx = Number(eh.dataset.eIdx);
          const asset = ProjectController.assets.find((a) => a.id === assetId);
          if (asset && Array.isArray(asset.polygon)) {
            const nextIdx = (idx + 1) % asset.polygon.length;
            const mid = [
              Math.round(((asset.polygon[idx][0] + asset.polygon[nextIdx][0]) / 2) * 100) / 100,
              Math.round(((asset.polygon[idx][1] + asset.polygon[nextIdx][1]) / 2) * 100) / 100,
            ];
            asset.polygon.splice(idx + 1, 0, mid);
            ProjectController.persistAssetPolygon(asset);
            ProjectController.vertexDrag = {
              assetId,
              idx: idx + 1,
              moved: true,
            };
          }
        });
        eh.addEventListener('contextmenu', (e) => {
          if (!ProjectController.editMode) return;
          e.preventDefault();
          e.stopPropagation();
          ProjectController.openCadGripMenu(e, eh.dataset.eAsset, Number(eh.dataset.eIdx), true);
        });
      });
    },

    async persistAssetPolygon(asset) {
      if (!asset || !Array.isArray(asset.polygon) || asset.polygon.length < 3) return;
      const bbox = ProjectController.computePolyBbox(asset.polygon);
      asset.shape = 'polygon';
      asset.x = bbox.x;
      asset.y = bbox.y;
      asset.w = bbox.w;
      asset.h = bbox.h;
      ProjectController.renderHotspots();
      try {
        await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(asset.id)}`,
          {
            method: 'PUT',
            body: { shape: 'polygon', polygon: asset.polygon, ...bbox },
          }
        );
      } catch (err) {
        App.toast(err.message || 'Failed to update polygon', 'error');
      }
    },

    insertPolygonVertexAt(assetId, xPct, yPct) {
      const asset = ProjectController.assets.find((a) => a.id === assetId);
      if (!asset || !Array.isArray(asset.polygon) || asset.polygon.length < 3) return;
      const poly = asset.polygon;
      let bestEdgeIdx = poly.length - 1;
      let bestDist = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lenSq = dx * dx + dy * dy;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((xPct - a[0]) * dx + (yPct - a[1]) * dy) / lenSq)) : 0;
        const px = a[0] + t * dx;
        const py = a[1] + t * dy;
        const d = (xPct - px) ** 2 + (yPct - py) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestEdgeIdx = i;
        }
      }
      if (bestDist > 9) return; // Only insert when clicking reasonably close to an edge
      poly.splice(bestEdgeIdx + 1, 0, [xPct, yPct]);
      ProjectController.persistAssetPolygon(asset);
      App.toast('Added polygon corner (right-click a corner to remove)', 'success');
    },

    removePolygonVertexAt(assetId, idx) {
      const asset = ProjectController.assets.find((a) => a.id === assetId);
      if (!asset || !Array.isArray(asset.polygon)) return;
      if (asset.polygon.length <= 3) {
        App.toast('A polygon requires at least 3 corners', 'error');
        return;
      }
      if (idx < 0 || idx >= asset.polygon.length) return;
      asset.polygon.splice(idx, 1);
      ProjectController.persistAssetPolygon(asset);
    },

    renderHotspots() {
      const layer = document.getElementById('hotspot-layer');
      if (!layer) return;

      ProjectController.renderPolygons();

      const assetsHtml = ProjectController.assets
        .map((a) => {
          const activeClass = a.id === ProjectController.selectedAssetId ? ' active' : '';
          const hasPoly = Array.isArray(a.polygon) && a.polygon.length >= 3;
          const shape = hasPoly ? 'polygon' : (a.shape || 'rect');
          const areaTag = a.area ? `<span class="hotspot-area">${App.escapeHtml(a.area)}</span>` : '';

          let badgeStyle = '';
          if (hasPoly) {
            const ax = ProjectController.parsePct(a.x, 0);
            const ay = ProjectController.parsePct(a.y, 0);
            const aw = Math.max(1, ProjectController.parsePct(a.w, 10));
            const ah = Math.max(1, ProjectController.parsePct(a.h, 10));
            const cx = a.polygon.reduce((s, p) => s + p[0], 0) / a.polygon.length;
            const cy = a.polygon.reduce((s, p) => s + p[1], 0) / a.polygon.length;
            const relX = Math.max(15, Math.min(85, ((cx - ax) / aw) * 100));
            const relY = Math.max(15, Math.min(85, ((cy - ay) / ah) * 100));
            badgeStyle = ` style="left:${relX.toFixed(1)}%;top:${relY.toFixed(1)}%;"`;
          }

          return `
            <div class="hotspot${activeClass}"
                 data-asset-id="${App.escapeHtml(a.id)}"
                 data-shape="${App.escapeHtml(shape)}"
                 style="left:${App.escapeHtml(a.x)};top:${App.escapeHtml(a.y)};width:${App.escapeHtml(a.w)};height:${App.escapeHtml(a.h)};">
              <div class="hotspot-badge"${badgeStyle}>
                <span class="hotspot-icon">${App.escapeHtml(a.icon || '🏢')}</span>
                <span class="hotspot-label">${App.escapeHtml(a.title)}</span>
                ${areaTag}
              </div>
              <button type="button" class="hotspot-del" data-del-hotspot="${App.escapeHtml(a.id)}" title="Delete zone from map">&times;</button>
              <span class="resize-handle nw" data-handle="nw"></span>
              <span class="resize-handle ne" data-handle="ne"></span>
              <span class="resize-handle sw" data-handle="sw"></span>
              <span class="resize-handle se" data-handle="se"></span>
            </div>
          `;
        })
        .join('');

      let ghostHtml = '';
      if (ProjectController.smartAssistOpen && ProjectController.smartSuggestions.length > 0) {
        ghostHtml = ProjectController.smartSuggestions
          .filter((s) => s.selected)
          .map(
            (s) => `
            <div class="sa-ghost-pin" data-sa-pin="${s.idx}" style="left:${s.xPct}%;top:${s.yPct}%;">
              ${App.escapeHtml(s.icon)} ${App.escapeHtml(s.text)}
            </div>`
          )
          .join('');
      }

      layer.innerHTML = assetsHtml + ghostHtml;

      layer.querySelectorAll('.hotspot').forEach((hs) => {
        const assetId = hs.dataset.assetId;

        hs.addEventListener('mousedown', (e) => {
          if (e.target.closest('[data-del-hotspot]')) {
            e.stopPropagation();
            return;
          }
          if (e.button !== 0) return;
          if (ProjectController.editMode) {
            e.stopPropagation();
            const handle = e.target.closest('.resize-handle')?.dataset.handle || null;
            ProjectController.startDrag(assetId, handle, e.clientX, e.clientY);
          }
        });

        hs.addEventListener('touchstart', (e) => {
          if (e.target.closest('[data-del-hotspot]')) {
            e.stopPropagation();
            return;
          }
          if (ProjectController.editMode && e.touches.length === 1) {
            e.stopPropagation();
            const handle = e.target.closest('.resize-handle')?.dataset.handle || null;
            ProjectController.startDrag(assetId, handle, e.touches[0].clientX, e.touches[0].clientY);
          }
        }, { passive: true });

        hs.addEventListener('click', (e) => {
          e.stopPropagation();
          const delBtn = e.target.closest('[data-del-hotspot]');
          if (delBtn) {
            ProjectController.deleteAssetById(delBtn.dataset.delHotspot);
            return;
          }
          if (ProjectController.editMode) {
            ProjectController.selectAsset(assetId, false);
          } else {
            ProjectController.selectAsset(assetId, true, hs);
          }
        });
      });

      layer.querySelectorAll('.sa-ghost-pin').forEach((pin) => {
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(pin.dataset.saPin);
          const item = document.querySelector(`.sa-item[data-sa-idx="${idx}"]`);
          if (item) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.style.borderColor = 'var(--accent)';
            setTimeout(() => { item.style.borderColor = ''; }, 1400);
          }
        });
      });
    },

    selectAsset(assetId, showPopup = true, anchorEl = null) {
      ProjectController.selectedAssetId = assetId;
      ProjectController.renderSidebar();
      document.querySelectorAll('.hotspot').forEach((el) => {
        el.classList.toggle('active', el.dataset.assetId === assetId);
      });
      document.querySelectorAll('.poly-zone').forEach((el) => {
        el.classList.toggle('active', el.dataset.polyAsset === assetId);
      });

      if (ProjectController.editMode) {
        document.getElementById('doc-popup').hidden = true;
        ProjectController.renderPolygons();
        ProjectController.openEditor(assetId);
      } else if (showPopup) {
        ProjectController.renderPolygons();
        const hs = anchorEl || document.querySelector(`.hotspot[data-asset-id="${CSS.escape(assetId)}"]`);
        ProjectController.openDocPopup(assetId, hs);
      } else {
        ProjectController.renderPolygons();
      }
    },

    /* ---------------- Hotspot Drag & Resize ---------------- */
    parsePct(val, fallback) {
      const n = parseFloat(val);
      return Number.isFinite(n) ? n : fallback;
    },

    startDrag(assetId, handle, clientX, clientY) {
      const asset = ProjectController.assets.find((a) => a.id === assetId);
      const layer = document.getElementById('hotspot-layer');
      if (!asset || !layer) return;

      ProjectController.selectAsset(assetId, false);
      const rect = layer.getBoundingClientRect();
      ProjectController.dragState = {
        assetId,
        handle, // null = move, 'nw'|'ne'|'sw'|'se' = resize
        startX: clientX,
        startY: clientY,
        layerW: rect.width || 1,
        layerH: rect.height || 1,
        origX: ProjectController.parsePct(asset.x, 10),
        origY: ProjectController.parsePct(asset.y, 10),
        origW: ProjectController.parsePct(asset.w, 15),
        origH: ProjectController.parsePct(asset.h, 12),
        moved: false,
      };
    },

    onPointerMove(e) {
      if (ProjectController.vertexDrag) {
        const vd = ProjectController.vertexDrag;
        const transformEl = document.getElementById('map-transform');
        const asset = ProjectController.assets.find((a) => a.id === vd.assetId);
        if (!transformEl || !asset || !Array.isArray(asset.polygon)) return;
        const pt = e.touches ? e.touches[0] : e;
        if (!pt) return;
        if (e.cancelable) e.preventDefault();

        const rect = transformEl.getBoundingClientRect();
        let xPct = Math.round(Math.max(0, Math.min(100, ((pt.clientX - rect.left) / (rect.width || 1)) * 100)) * 100) / 100;
        let yPct = Math.round(Math.max(0, Math.min(100, ((pt.clientY - rect.top) / (rect.height || 1)) * 100)) * 100) / 100;

        if (e.shiftKey || ProjectController.polyDraw.ortho) {
          const polyLen = asset.polygon.length;
          const prev = asset.polygon[(vd.idx - 1 + polyLen) % polyLen];
          const dx = Math.abs(xPct - prev[0]);
          const dy = Math.abs(yPct - prev[1]);
          if (dx >= dy) {
            yPct = prev[1];
          } else {
            xPct = prev[0];
          }
        }

        asset.polygon[vd.idx] = [xPct, yPct];
        vd.moved = true;

        const bbox = ProjectController.computePolyBbox(asset.polygon);
        asset.x = bbox.x;
        asset.y = bbox.y;
        asset.w = bbox.w;
        asset.h = bbox.h;

        const hs = document.querySelector(`.hotspot[data-asset-id="${CSS.escape(asset.id)}"]`);
        if (hs) {
          hs.style.left = asset.x;
          hs.style.top = asset.y;
          hs.style.width = asset.w;
          hs.style.height = asset.h;
        }
        ProjectController.renderPolygons();
        if (ProjectController.selectedAssetId === asset.id) {
          ProjectController.syncEditorInputs(asset);
        }
        return;
      }

      const ds = ProjectController.dragState;
      if (!ds) return;
      const pt = e.touches ? e.touches[0] : e;
      if (!pt) return;
      if (e.cancelable) e.preventDefault();

      const dxPct = ((pt.clientX - ds.startX) / ds.layerW) * 100;
      const dyPct = ((pt.clientY - ds.startY) / ds.layerH) * 100;
      if (Math.abs(dxPct) > 0.1 || Math.abs(dyPct) > 0.1) ds.moved = true;

      const asset = ProjectController.assets.find((a) => a.id === ds.assetId);
      if (!asset) return;

      let nx = ds.origX;
      let ny = ds.origY;
      let nw = ds.origW;
      let nh = ds.origH;

      if (!ds.handle) {
        nx = Math.max(0, Math.min(100 - nw, ds.origX + dxPct));
        ny = Math.max(0, Math.min(100 - nh, ds.origY + dyPct));
      } else {
        if (ds.handle.includes('e')) {
          nw = Math.max(3, Math.min(100 - nx, ds.origW + dxPct));
        }
        if (ds.handle.includes('s')) {
          nh = Math.max(3, Math.min(100 - ny, ds.origH + dyPct));
        }
        if (ds.handle.includes('w')) {
          const maxLeft = ds.origX + ds.origW - 3;
          nx = Math.max(0, Math.min(maxLeft, ds.origX + dxPct));
          nw = ds.origW + (ds.origX - nx);
        }
        if (ds.handle.includes('n')) {
          const maxTop = ds.origY + ds.origH - 3;
          ny = Math.max(0, Math.min(maxTop, ds.origY + dyPct));
          nh = ds.origH + (ds.origY - ny);
        }
      }

      asset.x = nx.toFixed(1) + '%';
      asset.y = ny.toFixed(1) + '%';
      asset.w = nw.toFixed(1) + '%';
      asset.h = nh.toFixed(1) + '%';

      const hs = document.querySelector(`.hotspot[data-asset-id="${CSS.escape(asset.id)}"]`);
      if (hs) {
        hs.style.left = asset.x;
        hs.style.top = asset.y;
        hs.style.width = asset.w;
        hs.style.height = asset.h;
      }

      if (ProjectController.selectedAssetId === asset.id) {
        ProjectController.syncEditorInputs(asset);
      }
    },

    async onPointerUp() {
      if (ProjectController.vertexDrag) {
        const vd = ProjectController.vertexDrag;
        ProjectController.vertexDrag = null;
        if (!vd.moved) return;
        const asset = ProjectController.assets.find((a) => a.id === vd.assetId);
        if (!asset) return;
        try {
          await App.api(
            `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(asset.id)}`,
            {
              method: 'PUT',
              body: { polygon: asset.polygon, x: asset.x, y: asset.y, w: asset.w, h: asset.h },
            }
          );
        } catch (err) {
          App.toast(err.message || 'Failed to save corner', 'error');
        }
        return;
      }

      const ds = ProjectController.dragState;
      if (!ds) return;
      ProjectController.dragState = null;
      if (!ds.moved) return;

      const asset = ProjectController.assets.find((a) => a.id === ds.assetId);
      if (!asset) return;
      try {
        await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(asset.id)}`,
          {
            method: 'PUT',
            body: { x: asset.x, y: asset.y, w: asset.w, h: asset.h },
          }
        );
      } catch (err) {
        App.toast(err.message || 'Failed to save position', 'error');
      }
    },

    /* ---------------- Document Popup ---------------- */
    getFileIcon(file) {
      const ext = ((file.original_name || file.label || '').split('.').pop() || '').toLowerCase();
      const map = {
        pdf: '📄',
        ifc: '🏗️',
        dxf: '📐',
        dwg: '📐',
        bak: '📐',
        skp: '🧊',
        skb: '🧊',
        pptx: '📊',
        ppt: '📊',
        rvt: '🏛️',
        rfa: '🏛️',
        '3dm': '🦏',
        glb: '🧊',
        gltf: '🧊',
        obj: '🧊',
        stl: '🧊',
        png: '🖼️',
        jpg: '🖼️',
        jpeg: '🖼️',
        webp: '🖼️',
        svg: '🖼️',
        gif: '🖼️',
        html: '🌐',
      };
      return map[ext] || '📎';
    },

    openDocPopup(assetId, anchorEl) {
      const asset = ProjectController.assets.find((a) => a.id === assetId);
      if (!asset) return;

      const popup = document.getElementById('doc-popup');
      const iconEl = document.getElementById('doc-popup-icon');
      const titleEl = document.getElementById('doc-popup-title');
      const subEl = document.getElementById('doc-popup-sub');
      const bodyEl = document.getElementById('doc-popup-body');

      iconEl.textContent = asset.icon || '🏢';
      iconEl.dataset.shape = asset.shape || 'rect';
      titleEl.textContent = asset.title;
      if (subEl) {
        const st = asset.status || 'WIP';
        const areaHtml = asset.area ? `<span>${App.escapeHtml(asset.area)}</span>` : '';
        subEl.innerHTML = `<span class="status-pill status-${App.escapeHtml(st)}">${App.escapeHtml(st)}</span>${areaHtml}`;
      }

      const files = ProjectController.getAssetFiles(assetId);
      const pre = ProjectController.precreatedCategories[assetId] || [];

      const byCat = {};
      CATEGORIES.forEach((c) => {
        byCat[c] = [];
      });
      files.forEach((f) => {
        const cat = CATEGORIES.includes(f.category) ? f.category : 'General';
        byCat[cat].push(f);
      });

      const activeCats = CATEGORIES.filter((c) => byCat[c].length > 0 || pre.includes(c));

      if (activeCats.length === 0) {
        bodyEl.innerHTML = `<div class="doc-empty">No documents uploaded for this asset yet.</div>`;
      } else {
        bodyEl.innerHTML = activeCats
          .map((cat) => {
            const catFiles = byCat[cat];
            const itemsHtml =
              catFiles.length === 0
                ? `<div style="padding:8px 10px;font-size:12px;color:var(--text-muted);border-top:1px solid var(--border)">Empty category</div>`
                : catFiles
                    .map(
                      (f) => `
                      <div class="doc-link" data-file-id="${App.escapeHtml(f.id)}">
                        <span>${ProjectController.getFileIcon(f)}</span>
                        <span class="doc-link-label" title="${App.escapeHtml(f.original_name || f.label)}">${App.escapeHtml(f.label || f.original_name)}</span>
                        <button type="button" class="doc-link-del" data-del-file="${App.escapeHtml(f.id)}" title="Delete file">&times;</button>
                      </div>
                    `
                    )
                    .join('');

            return `
              <div class="doc-cat-section">
                <button type="button" class="doc-cat-header">
                  <span>${App.escapeHtml(cat)}</span>
                  <span class="badge">${catFiles.length}</span>
                </button>
                <div class="doc-cat-items">${itemsHtml}</div>
              </div>
            `;
          })
          .join('');

        bodyEl.querySelectorAll('.doc-cat-header').forEach((hdr) => {
          hdr.addEventListener('click', () => {
            hdr.closest('.doc-cat-section')?.classList.toggle('collapsed');
          });
        });

        bodyEl.querySelectorAll('.doc-link').forEach((link) => {
          link.addEventListener('click', (e) => {
            const delBtn = e.target.closest('[data-del-file]');
            if (delBtn) {
              e.stopPropagation();
              ProjectController.deleteFile(delBtn.dataset.delFile);
              return;
            }
            const fileId = link.dataset.fileId;
            const file = ProjectController.files.find((x) => x.id === fileId);
            if (file && window.ViewerManager) {
              window.ViewerManager.open(ProjectController.project.id, file);
            }
          });
        });
      }

      popup.hidden = false;
      ProjectController.positionPopup(popup, anchorEl);
    },

    positionPopup(popup, anchorEl) {
      if (window.innerWidth <= 640) return; // CSS handles mobile positioning
      const pad = 16;
      const pw = popup.offsetWidth || 340;
      const ph = popup.offsetHeight || 320;

      if (anchorEl) {
        const r = anchorEl.getBoundingClientRect();
        let left = r.right + 12;
        let top = r.top;
        if (left + pw > window.innerWidth - pad) {
          left = r.left - pw - 12;
        }
        if (left < pad) left = Math.min(window.innerWidth - pw - pad, Math.max(pad, r.left));
        if (top + ph > window.innerHeight - pad) {
          top = window.innerHeight - ph - pad;
        }
        if (top < 70) top = 70;
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
      } else {
        popup.style.left = `${Math.max(pad, (window.innerWidth - pw) / 2)}px`;
        popup.style.top = '90px';
      }
    },

    /* ---------------- Asset Editor Panel ---------------- */
    bindEditorPanel() {
      document.getElementById('close-editor')?.addEventListener('click', () => {
        document.getElementById('editor-panel').hidden = true;
      });

      ['ed-x', 'ed-y', 'ed-w', 'ed-h', 'ed-title-input', 'ed-area', 'ed-status'].forEach((id) => {
        const el = document.getElementById(id);
        el?.addEventListener('input', () => ProjectController.previewEditorChanges());
        el?.addEventListener('change', () => ProjectController.previewEditorChanges());
      });

      document.querySelectorAll('.nudge-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const dir = btn.dataset.dir;
          const step = 0.5;
          const xEl = document.getElementById('ed-x');
          const yEl = document.getElementById('ed-y');
          let x = parseFloat(xEl.value) || 0;
          let y = parseFloat(yEl.value) || 0;
          if (dir === 'up') y = Math.max(0, y - step);
          if (dir === 'down') y = Math.min(100, y + step);
          if (dir === 'left') x = Math.max(0, x - step);
          if (dir === 'right') x = Math.min(100, x + step);
          xEl.value = x.toFixed(1);
          yEl.value = y.toFixed(1);
          ProjectController.previewEditorChanges();
        });
      });

      document.querySelectorAll('#icon-picker .icon-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#icon-picker .icon-opt').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          ProjectController.previewEditorChanges();
        });
      });

      document.querySelectorAll('#shape-picker .shape-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#shape-picker .shape-opt').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          ProjectController.previewEditorChanges();
        });
      });

      document.getElementById('save-asset-btn')?.addEventListener('click', () => {
        ProjectController.saveEditorChanges();
      });

      document.getElementById('snap-poly-btn')?.addEventListener('click', () => {
        if (ProjectController.selectedAssetId) {
          ProjectController.snapAssetToMapBoundary(ProjectController.selectedAssetId);
        }
      });

      document.getElementById('pick-align-btn')?.addEventListener('click', () => {
        if (ProjectController.selectedAssetId) {
          ProjectController.startMagicTrace(ProjectController.selectedAssetId);
        }
      });

      document.getElementById('redraw-poly-btn')?.addEventListener('click', () => {
        if (ProjectController.selectedAssetId) {
          ProjectController.startPolygonDraw(ProjectController.selectedAssetId);
        }
      });

      document.getElementById('delete-asset-btn')?.addEventListener('click', () => {
        ProjectController.deleteActiveAsset();
      });
    },

    openEditor(assetId) {
      const asset = ProjectController.assets.find((a) => a.id === assetId);
      if (!asset) return;
      document.getElementById('editor-asset-title').textContent = asset.title;
      const titleIn = document.getElementById('ed-title-input');
      const areaIn = document.getElementById('ed-area');
      const statusIn = document.getElementById('ed-status');
      const redrawBtn = document.getElementById('redraw-poly-btn');
      if (titleIn) titleIn.value = asset.title || '';
      if (areaIn) areaIn.value = asset.area || '';
      if (statusIn) statusIn.value = asset.status || 'WIP';
      if (redrawBtn) redrawBtn.hidden = (asset.shape !== 'polygon' && !asset.polygon);

      ProjectController.syncEditorInputs(asset);

      document.querySelectorAll('#icon-picker .icon-opt').forEach((b) => {
        b.classList.toggle('selected', b.dataset.icon === (asset.icon || '🏢'));
      });
      document.querySelectorAll('#shape-picker .shape-opt').forEach((b) => {
        b.classList.toggle('selected', b.dataset.shape === (asset.shape || 'rect'));
      });

      document.getElementById('editor-panel').hidden = false;
    },

    syncEditorInputs(asset) {
      document.getElementById('ed-x').value = ProjectController.parsePct(asset.x, 10).toFixed(1);
      document.getElementById('ed-y').value = ProjectController.parsePct(asset.y, 10).toFixed(1);
      document.getElementById('ed-w').value = ProjectController.parsePct(asset.w, 15).toFixed(1);
      document.getElementById('ed-h').value = ProjectController.parsePct(asset.h, 12).toFixed(1);
    },

    previewEditorChanges() {
      const asset = ProjectController.assets.find((a) => a.id === ProjectController.selectedAssetId);
      if (!asset) return;

      const x = (parseFloat(document.getElementById('ed-x').value) || 0).toFixed(1) + '%';
      const y = (parseFloat(document.getElementById('ed-y').value) || 0).toFixed(1) + '%';
      const w = Math.max(1, parseFloat(document.getElementById('ed-w').value) || 10).toFixed(1) + '%';
      const h = Math.max(1, parseFloat(document.getElementById('ed-h').value) || 10).toFixed(1) + '%';
      const icon = document.querySelector('#icon-picker .icon-opt.selected')?.dataset.icon || asset.icon;
      const shape = document.querySelector('#shape-picker .shape-opt.selected')?.dataset.shape || asset.shape;
      const titleVal = document.getElementById('ed-title-input')?.value.trim();
      const areaVal = document.getElementById('ed-area')?.value.trim();
      const statusVal = document.getElementById('ed-status')?.value;
      const redrawBtn = document.getElementById('redraw-poly-btn');
      if (redrawBtn) redrawBtn.hidden = (shape !== 'polygon' && !asset.polygon);

      asset.x = x;
      asset.y = y;
      asset.w = w;
      asset.h = h;
      asset.icon = icon;
      asset.shape = shape;
      if (titleVal) asset.title = titleVal;
      if (areaVal !== undefined) asset.area = areaVal;
      if (statusVal) asset.status = statusVal;

      const hs = document.querySelector(`.hotspot[data-asset-id="${CSS.escape(asset.id)}"]`);
      if (hs) {
        hs.style.left = x;
        hs.style.top = y;
        hs.style.width = w;
        hs.style.height = h;
        hs.dataset.shape = shape;
        const ic = hs.querySelector('.hotspot-icon');
        if (ic) ic.textContent = icon;
        const lbl = hs.querySelector('.hotspot-label');
        if (lbl) lbl.textContent = asset.title;
      }
      ProjectController.renderSidebar();
    },

    async saveEditorChanges() {
      const asset = ProjectController.assets.find((a) => a.id === ProjectController.selectedAssetId);
      if (!asset) return;
      ProjectController.previewEditorChanges();

      try {
        const res = await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(asset.id)}`,
          {
            method: 'PUT',
            body: {
              title: asset.title,
              icon: asset.icon,
              shape: asset.shape,
              x: asset.x,
              y: asset.y,
              w: asset.w,
              h: asset.h,
              area: asset.area || '',
              status: asset.status || 'WIP',
              polygon: asset.shape === 'polygon' ? asset.polygon : null,
            },
          }
        );
        if (res && res.asset) {
          Object.assign(asset, res.asset);
        }
        ProjectController.renderHotspots();
        App.toast('Asset updated', 'success');
      } catch (err) {
        App.toast(err.message || 'Failed to save asset', 'error');
      }
    },

    getSitePlanPdfFile() {
      return (
        ProjectController.files.find((f) => /\.pdf$/i.test(f.original_name || '') && f.category === 'Site Plan') ||
        ProjectController.files.find((f) => /\.pdf$/i.test(f.original_name || '') && /site/i.test(f.original_name || '')) ||
        ProjectController.files.find((f) => /\.pdf$/i.test(f.original_name || '')) ||
        null
      );
    },

    async ensurePdfVectorsLoaded() {
      if (ProjectController._cachedPdfVectors !== null) return ProjectController._cachedPdfVectors;
      const sitePdf = ProjectController.getSitePlanPdfFile();
      if (!sitePdf || !ProjectController.project || !window.SmartAssist?.extractPdfLabelsFromBuffer) {
        ProjectController._cachedPdfVectors = false;
        return null;
      }
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/${encodeURIComponent(sitePdf.id)}/download?inline=1`,
          { credentials: 'same-origin' }
        );
        if (!res.ok) throw new Error('PDF fetch failed');
        const buf = await res.arrayBuffer();
        const extracted = await window.SmartAssist.extractPdfLabelsFromBuffer(buf);
        ProjectController._cachedPdfVectors = extracted.vectorGeometry || false;
      } catch {
        ProjectController._cachedPdfVectors = false;
      }
      return ProjectController._cachedPdfVectors;
    },

    async traceBestBoundaryAt(xPct, yPct, { onStatus = null } = {}) {
      // Tier 1: Native Vector PDF closed polygons / planar CAD faces (auto-load after reload)
      await ProjectController.ensurePdfVectorsLoaded();
      if (ProjectController._cachedPdfVectors && typeof window.SmartAssist?.findVectorPolygonAt === 'function') {
        const vec = window.SmartAssist.findVectorPolygonAt(ProjectController._cachedPdfVectors, xPct, yPct);
        if (vec && Array.isArray(vec.polygon) && vec.polygon.length >= 3) {
          return vec;
        }
      }
      // Tier 2: In-Browser SlimSAM (WebGPU / WASM)
      const imgEl = document.getElementById('map-image');
      if (window.SlimSamSegmenter && imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
        return window.SlimSamSegmenter.segmentAtPoint(imgEl, xPct, yPct, onStatus);
      }
      return null;
    },

    async saveTracedShapeForAsset(asset, traced) {
      if (!asset || !traced || !ProjectController.project) return false;
      const res = await App.api(
        `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(asset.id)}`,
        {
          method: 'PUT',
          body: {
            shape: 'polygon',
            polygon: traced.polygon,
            x: traced.bbox.x,
            y: traced.bbox.y,
            w: traced.bbox.w,
            h: traced.bbox.h,
          },
        }
      );
      if (res && res.asset) Object.assign(asset, res.asset);
      return true;
    },

    async snapAssetToMapBoundary(assetId) {
      const asset = ProjectController.assets.find((a) => a.id === assetId);
      if (!asset || !window.SmartAssist) return;

      const detected = Array.isArray(ProjectController.project?.detected_labels)
        ? ProjectController.project.detected_labels
        : [];
      const matchedLbl = detected.find(
        (l) => l.text && asset.title && l.text.toLowerCase() === asset.title.toLowerCase()
      );
      const cx = matchedLbl
        ? matchedLbl.xPct
        : ProjectController.parsePct(asset.x, 10) + ProjectController.parsePct(asset.w, 12) / 2;
      const cy = matchedLbl
        ? matchedLbl.yPct
        : ProjectController.parsePct(asset.y, 10) + ProjectController.parsePct(asset.h, 10) / 2;

      const traced = await ProjectController.traceBestBoundaryAt(cx, cy);
      if (!traced) {
        App.toast(`No automatic boundary at "${asset.title}" — click directly inside its shape on the map to align.`, 'info');
        ProjectController.startMagicTrace(asset.id);
        return;
      }

      try {
        await ProjectController.saveTracedShapeForAsset(asset, traced);
        ProjectController.renderSidebar();
        ProjectController.renderHotspots();
        if (ProjectController.editMode) ProjectController.openEditor(asset.id);
        App.toast(`Aligned "${asset.title}" to ${traced.polygon.length}-corner map shape!`, 'success');
      } catch (err) {
        App.toast(err.message || 'Failed to align shape', 'error');
      }
    },

    async deleteAssetById(assetId) {
      const asset = ProjectController.assets.find((a) => a.id === assetId);
      if (!asset) return;
      const ok = await App.confirm(
        'Delete Asset',
        `Delete "${asset.title}" from this site map? Attached files will remain in Project Files as unassigned.`,
        'Delete Asset'
      );
      if (!ok) return;

      try {
        await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(asset.id)}`,
          { method: 'DELETE' }
        );
        ProjectController.assets = ProjectController.assets.filter((a) => a.id !== asset.id);
        ProjectController.files.forEach((f) => {
          if (f.asset_id === asset.id) f.asset_id = null;
        });
        if (ProjectController.selectedAssetId === asset.id) {
          ProjectController.selectedAssetId = null;
          document.getElementById('editor-panel').hidden = true;
          document.getElementById('doc-popup').hidden = true;
        }
        ProjectController.renderSidebar();
        ProjectController.renderHotspots();
        App.toast('Asset deleted from map', 'success');
      } catch (err) {
        App.toast(err.message || 'Failed to delete asset', 'error');
      }
    },

    async deleteActiveAsset() {
      if (ProjectController.selectedAssetId) {
        await ProjectController.deleteAssetById(ProjectController.selectedAssetId);
      }
    },

    /* ---------------- Add Asset Modal ---------------- */
    openAddAssetModal(opts = {}) {
      document.getElementById('add-asset-form').reset();
      document.getElementById('aa-error').textContent = '';
      if (!opts.keepPolygon) ProjectController.pendingPolygon = null;
      document.querySelectorAll('#aa-icon-picker .icon-opt').forEach((b, i) => {
        b.classList.toggle('selected', i === 0);
      });
      document.querySelectorAll('#aa-shape-picker .shape-opt').forEach((b, i) => {
        b.classList.toggle('selected', i === 0);
      });
      document.getElementById('add-asset-modal').hidden = false;
      setTimeout(() => document.getElementById('aa-title').focus(), 50);
    },

    bindAddAssetModal() {
      document.querySelectorAll('#aa-icon-picker .icon-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#aa-icon-picker .icon-opt').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });

      document.querySelectorAll('#aa-shape-picker .shape-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#aa-shape-picker .shape-opt').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });

      document.getElementById('add-asset-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('aa-title').value.trim();
        const area = (document.getElementById('aa-area')?.value || '').trim();
        const status = document.getElementById('aa-status')?.value || 'WIP';
        const errEl = document.getElementById('aa-error');
        errEl.textContent = '';
        if (!title) {
          errEl.textContent = 'Asset title is required.';
          return;
        }
        const icon = document.querySelector('#aa-icon-picker .icon-opt.selected')?.dataset.icon || '🏢';
        let shape = document.querySelector('#aa-shape-picker .shape-opt.selected')?.dataset.shape || 'rect';
        const checkedCats = Array.from(
          document.querySelectorAll('#add-asset-form input[type="checkbox"]:checked')
        ).map((cb) => cb.value);

        const offset = (ProjectController.assets.length % 6) * 5;
        let coords = { x: `${15 + offset}%`, y: `${15 + offset}%`, w: '14%', h: '12%' };
        let polygon = null;
        if (ProjectController.pendingPolygon && ProjectController.pendingPolygon.points.length >= 3) {
          polygon = ProjectController.pendingPolygon.points;
          coords = ProjectController.pendingPolygon.bbox;
          shape = 'polygon';
        }

        try {
          const res = await App.api(
            `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets`,
            {
              method: 'POST',
              body: {
                title,
                icon,
                shape,
                area,
                status,
                polygon,
                ...coords,
              },
            }
          );
          if (res && res.asset) {
            ProjectController.pendingPolygon = null;
            ProjectController.assets.push(res.asset);
            ProjectController.precreatedCategories[res.asset.id] = checkedCats;
            document.getElementById('add-asset-modal').hidden = true;
            ProjectController.renderSidebar();
            ProjectController.renderHotspots();
            ProjectController.selectAsset(res.asset.id, true);
            App.toast(`Asset "${title}" created`, 'success');
          }
        } catch (err) {
          errEl.textContent = err.message || 'Failed to create asset.';
        }
      });
    },

    /* ---------------- Map Upload ---------------- */
    bindMapUpload() {
      const dz = document.getElementById('map-drop-zone');
      const input = document.getElementById('map-file-input');
      const browseBtn = document.getElementById('browse-map-btn');

      if (browseBtn && input) {
        browseBtn.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
          if (input.files[0]) ProjectController.uploadMapFile(input.files[0]);
          input.value = '';
        });
      }
      if (dz) {
        dz.addEventListener('dragover', (e) => {
          e.preventDefault();
          dz.classList.add('dragover');
        });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', (e) => {
          e.preventDefault();
          dz.classList.remove('dragover');
          if (e.dataTransfer.files[0]) ProjectController.uploadMapFile(e.dataTransfer.files[0]);
        });
      }
    },

    async uploadMapFile(file, opts = {}) {
      const errEl = document.getElementById('map-upload-error');
      const statusEl = document.getElementById('map-upload-status');
      if (errEl) errEl.textContent = '';
      if (statusEl) statusEl.textContent = '';

      try {
        let mapToUpload = file;
        if (/\.pdf$/i.test(file.name)) {
          if (statusEl) statusEl.textContent = 'Rendering PDF Site Plan page 1 at high resolution…';
          mapToUpload = await ProjectController.renderPdfFirstPageToPng(file);
        }

        const fd = new FormData();
        fd.append('map', mapToUpload);

        const res = await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/upload-map`,
          { method: 'POST', body: fd }
        );
        ProjectController.project.map_path = (res && res.path) || 'uploaded';
        ProjectController.updateMapImage();

        // Also save the original PDF into Project Files under Site Plan if uploaded directly
        if (/\.pdf$/i.test(file.name) && !opts.skipSaveToFiles) {
          const pdfFd = new FormData();
          pdfFd.append('files', file);
          pdfFd.append('category', 'Site Plan');
          try {
            const up = await App.api(
              `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/upload`,
              { method: 'POST', body: pdfFd }
            );
            if (up && up.files) {
              ProjectController.files.push(...up.files);
              ProjectController.renderSidebar();
            }
          } catch {
            // Optional archive copy
          }
        }

        if (statusEl) statusEl.textContent = '';
        document.getElementById('upload-map-modal').hidden = true;
        App.toast('Site map updated!', 'success');

        // Auto-extract exact vector labels from PDF Site Plans (zero hallucination)
        if (/\.pdf$/i.test(file.name) && window.SmartAssist) {
          try {
            const pdfBuf = await file.arrayBuffer();
            const extracted = await window.SmartAssist.extractPdfLabelsFromBuffer(pdfBuf);
            if (extracted.labels.length > 0) {
              await ProjectController.saveDetectedLabels(extracted.labels);
              ProjectController.loadSuggestionsFromLabels(extracted.labels, extracted.siteAreaText);
              ProjectController.openSmartAssist();
            }
          } catch {
            // Best-effort extraction
          }
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = '';
        if (errEl) errEl.textContent = err.message || 'Failed to upload map.';
        if (opts.skipSaveToFiles) throw err;
      }
    },

    /* ---------------- File Upload Modal ---------------- */
    openUploadModal(assetId) {
      ProjectController.uploadTargetAssetId = assetId;
      ProjectController.pendingFiles = [];
      document.getElementById('upload-file-list').innerHTML = '';
      document.getElementById('upload-label').value = '';
      document.getElementById('upload-error').textContent = '';
      document.getElementById('upload-progress').hidden = true;
      document.getElementById('do-upload-btn').disabled = true;
      document.getElementById('upload-modal').hidden = false;
    },

    bindFileUploadModal() {
      const dz = document.getElementById('drop-zone');
      const input = document.getElementById('file-input');
      const browse = document.getElementById('browse-files-btn');
      const doBtn = document.getElementById('do-upload-btn');

      if (browse && input) {
        browse.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
          ProjectController.addPendingFiles(input.files);
          input.value = '';
        });
      }
      if (dz) {
        dz.addEventListener('dragover', (e) => {
          e.preventDefault();
          dz.classList.add('dragover');
        });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', (e) => {
          e.preventDefault();
          dz.classList.remove('dragover');
          ProjectController.addPendingFiles(e.dataTransfer.files);
        });
      }
      if (doBtn) {
        doBtn.addEventListener('click', () => ProjectController.performFileUpload());
      }
    },

    addPendingFiles(fileList) {
      if (!fileList || fileList.length === 0) return;
      for (const f of fileList) {
        const base = (f.name || '').toLowerCase();
        if (IGNORED_OS_FILES.has(base) || base.startsWith('~$')) continue;
        ProjectController.pendingFiles.push(f);
      }
      const labelInput = document.getElementById('upload-label');
      if (labelInput && !labelInput.value && ProjectController.pendingFiles.length === 1) {
        const name = ProjectController.pendingFiles[0].name;
        labelInput.value = name.replace(/\.[^.]+$/, '');
      }
      ProjectController.renderPendingFiles();
    },

    renderPendingFiles() {
      const list = document.getElementById('upload-file-list');
      const doBtn = document.getElementById('do-upload-btn');
      doBtn.disabled = ProjectController.pendingFiles.length === 0;

      list.innerHTML = ProjectController.pendingFiles
        .map(
          (f, idx) => `
          <div class="upload-file-chip">
            <span>${App.escapeHtml(f.name)} (${App.formatBytes(f.size)})</span>
            <button type="button" class="btn btn-ghost btn-xs" data-rm-file="${idx}">&times;</button>
          </div>
        `
        )
        .join('');

      list.querySelectorAll('[data-rm-file]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.rmFile);
          ProjectController.pendingFiles.splice(idx, 1);
          ProjectController.renderPendingFiles();
        });
      });
    },

    async performFileUpload() {
      if (ProjectController.pendingFiles.length === 0 || !ProjectController.project) return;
      const category = document.getElementById('upload-category').value;
      const label = document.getElementById('upload-label').value.trim();
      const progressWrap = document.getElementById('upload-progress');
      const progressFill = document.getElementById('upload-progress-fill');
      const progressText = document.getElementById('upload-progress-text');
      const errEl = document.getElementById('upload-error');
      const doBtn = document.getElementById('do-upload-btn');

      errEl.textContent = '';
      progressWrap.hidden = false;
      progressFill.style.width = '0%';
      doBtn.disabled = true;

      const allFiles = ProjectController.pendingFiles.slice();
      const total = allFiles.length;
      const uploadedAll = [];

      try {
        for (let start = 0; start < total; start += 10) {
          const chunk = allFiles.slice(start, start + 10);
          progressText.textContent = `Uploading ${start + 1}–${Math.min(start + 10, total)} of ${total}…`;

          const fd = new FormData();
          const relPaths = [];
          chunk.forEach((f) => {
            fd.append('files', f);
            relPaths.push(f.webkitRelativePath || f.name);
          });
          if (ProjectController.uploadTargetAssetId) {
            fd.append('asset_id', ProjectController.uploadTargetAssetId);
          }
          fd.append('category', category);
          if (total === 1 && label) fd.append('label', label);
          fd.append('relative_paths', JSON.stringify(relPaths));

          const data = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/upload`);
            xhr.withCredentials = true;

            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const overall = ((start + (e.loaded / e.total) * chunk.length) / total) * 100;
                progressFill.style.width = `${Math.round(overall)}%`;
              }
            });

            xhr.addEventListener('load', () => {
              let parsed = null;
              try { parsed = JSON.parse(xhr.responseText); } catch { parsed = null; }
              if (xhr.status === 401) {
                const err = new Error('Session expired');
                err.status = 401;
                reject(err);
                return;
              }
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(parsed || {});
              } else {
                reject(new Error((parsed && (parsed.error || parsed.message)) || 'Upload failed.'));
              }
            });

            xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
            xhr.send(fd);
          });

          if (data.files) uploadedAll.push(...data.files);
        }

        ProjectController.files.push(...uploadedAll);
        document.getElementById('upload-modal').hidden = true;
        ProjectController.renderSidebar();
        if (ProjectController.uploadTargetAssetId) {
          const hs = document.querySelector(
            `.hotspot[data-asset-id="${CSS.escape(ProjectController.uploadTargetAssetId)}"]`
          );
          ProjectController.openDocPopup(ProjectController.uploadTargetAssetId, hs);
        }
        App.toast(`Uploaded ${uploadedAll.length || total} file(s)`, 'success');
      } catch (err) {
        if (err && err.status === 401) {
          App.user = null;
          document.getElementById('upload-modal').hidden = true;
          App.navigate('#/login');
          return;
        }
        errEl.textContent = (err && err.message) || 'Upload failed.';
        doBtn.disabled = false;
      }
    },

    async deleteFile(fileId) {
      const file = ProjectController.files.find((f) => f.id === fileId);
      const ok = await App.confirm(
        'Delete File',
        `Remove "${file ? file.label || file.original_name : 'this file'}"?`,
        'Delete'
      );
      if (!ok) return;

      try {
        await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/${encodeURIComponent(fileId)}`,
          { method: 'DELETE' }
        );
        ProjectController.files = ProjectController.files.filter((f) => f.id !== fileId);
        ProjectController.renderSidebar();
        if (ProjectController.selectedAssetId) {
          const hs = document.querySelector(
            `.hotspot[data-asset-id="${CSS.escape(ProjectController.selectedAssetId)}"]`
          );
          ProjectController.openDocPopup(ProjectController.selectedAssetId, hs);
        }
        App.toast('File deleted', 'success');
      } catch (err) {
        App.toast(err.message || 'Failed to delete file', 'error');
      }
    },

    /* ---------------- Export JSON ---------------- */
    async exportJson() {
      if (!ProjectController.project) return;
      let payload;
      try {
        payload = await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/export`
        );
      } catch {
        payload = {
          project: ProjectController.project,
          assets: ProjectController.assets,
          files: ProjectController.files,
          exportedAt: new Date().toISOString(),
        };
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = (ProjectController.project.name || 'project')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      a.href = url;
      a.download = `${slug || 'project'}-export.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      App.toast('Project exported as JSON', 'success');
    },

    /* ---------------- Polygon Zone Drawing & CAD Controls ---------------- */
    toggleOrthoMode(forceVal) {
      ProjectController.polyDraw.ortho =
        typeof forceVal === 'boolean' ? forceVal : !ProjectController.polyDraw.ortho;
      const btn = document.getElementById('poly-ortho-btn');
      if (btn) {
        btn.textContent = ProjectController.polyDraw.ortho ? 'Ortho: ON' : 'Ortho: OFF';
        btn.classList.toggle('btn-primary', ProjectController.polyDraw.ortho);
        btn.classList.toggle('btn-ghost', !ProjectController.polyDraw.ortho);
      }
      const badge = document.getElementById('cad-ortho-badge');
      if (badge) badge.hidden = !ProjectController.polyDraw.ortho;
      App.toast(
        ProjectController.polyDraw.ortho
          ? 'CAD Ortho ON (Locked to 0°, 90°, 180°, 270°)'
          : 'CAD Ortho OFF',
        'info',
        1000
      );
    },

    updateCadCrosshair(e) {
      const overlay = document.getElementById('cad-crosshair-overlay');
      if (!overlay) return;
      overlay.hidden = false;

      const viewport = document.getElementById('map-viewport');
      const transformEl = document.getElementById('map-transform');
      if (!viewport || !transformEl) return;

      const vpRect = viewport.getBoundingClientRect();
      const tRect = transformEl.getBoundingClientRect();
      if (!vpRect.width || !tRect.width) return;

      let rawX = Math.max(0, Math.min(100, ((e.clientX - tRect.left) / tRect.width) * 100));
      let rawY = Math.max(0, Math.min(100, ((e.clientY - tRect.top) / tRect.height) * 100));
      rawX = Math.round(rawX * 100) / 100;
      rawY = Math.round(rawY * 100) / 100;

      const pts = ProjectController.polyDraw.points;
      const isOrtho = ProjectController.polyDraw.ortho || e.shiftKey;

      if (isOrtho && pts.length > 0) {
        const last = pts[pts.length - 1];
        const dx = Math.abs(rawX - last[0]);
        const dy = Math.abs(rawY - last[1]);
        if (dx >= dy) {
          rawY = last[1];
        } else {
          rawX = last[0];
        }
      }

      let snapped = false;
      if (pts.length >= 2) {
        const start = pts[0];
        const distToStart = Math.hypot(rawX - start[0], rawY - start[1]);
        if (distToStart <= 2.8) {
          rawX = start[0];
          rawY = start[1];
          snapped = true;
        }
      }
      ProjectController.polyDraw.snapped = snapped;

      const finalVx = tRect.left + (rawX / 100) * tRect.width - vpRect.left;
      const finalVy = tRect.top + (rawY / 100) * tRect.height - vpRect.top;

      const hLine = document.getElementById('cad-crosshair-h');
      const vLine = document.getElementById('cad-crosshair-v');
      const pickbox = document.getElementById('cad-pickbox');
      const readout = document.getElementById('cad-dynamic-readout');
      const snapMarker = document.getElementById('cad-snap-marker');

      if (hLine) hLine.style.top = `${finalVy}px`;
      if (vLine) vLine.style.left = `${finalVx}px`;
      if (pickbox) {
        pickbox.style.left = `${finalVx}px`;
        pickbox.style.top = `${finalVy}px`;
      }

      if (snapMarker) {
        if (snapped && pts.length >= 2) {
          snapMarker.style.left = `${finalVx}px`;
          snapMarker.style.top = `${finalVy}px`;
          snapMarker.hidden = false;
        } else {
          snapMarker.hidden = true;
        }
      }

      if (readout) {
        readout.style.left = `${Math.min(vpRect.width - 150, finalVx + 14)}px`;
        readout.style.top = `${Math.min(vpRect.height - 40, finalVy + 14)}px`;

        const distEl = document.getElementById('cad-dim-dist');
        const angEl = document.getElementById('cad-dim-ang');
        const orthoBadge = document.getElementById('cad-ortho-badge');

        if (orthoBadge) orthoBadge.hidden = !isOrtho;

        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          const dx = rawX - last[0];
          const dy = rawY - last[1];
          const distPct = Math.hypot(dx, dy);
          let deg = Math.round((Math.atan2(-dy, dx) * (180 / Math.PI) + 360) % 360);
          if (distEl) distEl.textContent = `${(distPct * 10).toFixed(2)} m`;
          if (angEl) angEl.textContent = `${deg}°`;
          readout.hidden = false;
        } else {
          readout.hidden = true;
        }
      }

      ProjectController.polyDraw.currentMouse = [rawX, rawY];
      ProjectController.renderPolygons();
    },

    openCadGripMenu(e, assetId, idx, isEdge) {
      e.preventDefault();
      e.stopPropagation();
      ProjectController.cadMenuTarget = { assetId, idx, isEdge };
      const menu = document.getElementById('cad-grip-menu');
      if (!menu) return;
      const viewport = document.getElementById('map-viewport');
      const vpRect = viewport
        ? viewport.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

      const posX = Math.max(10, Math.min(vpRect.width - 150, e.clientX - vpRect.left + 5));
      const posY = Math.max(10, Math.min(vpRect.height - 120, e.clientY - vpRect.top + 5));
      menu.style.left = `${posX}px`;
      menu.style.top = `${posY}px`;
      menu.hidden = false;
    },

    closeCadGripMenu() {
      const menu = document.getElementById('cad-grip-menu');
      if (menu) menu.hidden = true;
      ProjectController.cadMenuTarget = null;
    },

    bindCadGripMenu() {
      const menu = document.getElementById('cad-grip-menu');
      if (!menu) return;

      menu.querySelectorAll('[data-grip-action]').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = item.dataset.gripAction;
          const target = ProjectController.cadMenuTarget;
          ProjectController.closeCadGripMenu();
          if (!target) return;

          const asset = ProjectController.assets.find((a) => a.id === target.assetId);
          if (!asset || !Array.isArray(asset.polygon)) return;

          if (action === 'stretch') {
            if (target.isEdge) {
              const vi = target.idx;
              const nextVi = (vi + 1) % asset.polygon.length;
              const mid = [
                Math.round(((asset.polygon[vi][0] + asset.polygon[nextVi][0]) / 2) * 100) / 100,
                Math.round(((asset.polygon[vi][1] + asset.polygon[nextVi][1]) / 2) * 100) / 100,
              ];
              asset.polygon.splice(vi + 1, 0, mid);
              ProjectController.persistAssetPolygon(asset);
              ProjectController.vertexDrag = {
                assetId: target.assetId,
                idx: vi + 1,
                moved: true,
              };
              App.toast('Stretching new edge vertex — move cursor to position', 'info');
            } else {
              ProjectController.vertexDrag = {
                assetId: target.assetId,
                idx: target.idx,
                moved: true,
              };
              App.toast('Stretching vertex — move cursor to position', 'info');
            }
          } else if (action === 'add') {
            const vi = target.idx;
            const nextVi = (vi + 1) % asset.polygon.length;
            const mid = [
              Math.round(((asset.polygon[vi][0] + asset.polygon[nextVi][0]) / 2) * 100) / 100,
              Math.round(((asset.polygon[vi][1] + asset.polygon[nextVi][1]) / 2) * 100) / 100,
            ];
            asset.polygon.splice(vi + 1, 0, mid);
            ProjectController.persistAssetPolygon(asset);
            App.toast('Added vertex to polygon', 'success');
          } else if (action === 'remove') {
            ProjectController.removePolygonVertexAt(target.assetId, target.idx);
          }
        });
      });

      window.addEventListener('click', () => {
        ProjectController.closeCadGripMenu();
      });
    },

    bindPolygonDrawing() {
      document.getElementById('draw-poly-btn')?.addEventListener('click', () => {
        if (ProjectController.polyDraw.active) {
          ProjectController.cancelPolygonDraw();
        } else {
          ProjectController.startPolygonDraw(null);
        }
      });
      document.getElementById('poly-ortho-btn')?.addEventListener('click', () => {
        ProjectController.toggleOrthoMode();
      });
      document.getElementById('poly-undo-btn')?.addEventListener('click', () => {
        if (ProjectController.polyDraw.points.length > 0) {
          ProjectController.polyDraw.points.pop();
          document.getElementById('poly-finish-btn').disabled =
            ProjectController.polyDraw.points.length < 3;
          ProjectController.renderPolygons();
        }
      });
      document.getElementById('poly-finish-btn')?.addEventListener('click', () => {
        ProjectController.finishPolygonDraw();
      });
      document.getElementById('poly-cancel-btn')?.addEventListener('click', () => {
        ProjectController.cancelPolygonDraw();
      });

      const viewport = document.getElementById('map-viewport');
      viewport?.addEventListener('mousemove', (e) => {
        if (!ProjectController.polyDraw.active) return;
        ProjectController.updateCadCrosshair(e);
      });
      viewport?.addEventListener('mouseleave', () => {
        if (!ProjectController.polyDraw.active) return;
        const overlay = document.getElementById('cad-crosshair-overlay');
        if (overlay) overlay.hidden = true;
      });
      viewport?.addEventListener('mouseenter', () => {
        if (ProjectController.polyDraw.active) {
          const overlay = document.getElementById('cad-crosshair-overlay');
          if (overlay) overlay.hidden = false;
        }
      });

      viewport?.addEventListener('click', (e) => {
        if (!ProjectController.polyDraw.active) return;
        if (e.target.closest('#poly-draw-bar') || e.target.closest('#cad-grip-menu')) return;

        const transformEl = document.getElementById('map-transform');
        if (!transformEl) return;
        const rect = transformEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        // Snapped to start vertex to close shape
        if (ProjectController.polyDraw.snapped && ProjectController.polyDraw.points.length >= 3) {
          ProjectController.finishPolygonDraw();
          return;
        }

        let xPct, yPct;
        if (ProjectController.polyDraw.currentMouse) {
          [xPct, yPct] = ProjectController.polyDraw.currentMouse;
        } else {
          xPct =
            Math.round(
              Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)) * 100
            ) / 100;
          yPct =
            Math.round(
              Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)) * 100
            ) / 100;
        }

        const pts = ProjectController.polyDraw.points;
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          if (Math.hypot(xPct - last[0], yPct - last[1]) < 0.25) return;
        }

        pts.push([xPct, yPct]);
        const finishBtn = document.getElementById('poly-finish-btn');
        if (finishBtn) finishBtn.disabled = pts.length < 3;

        const hint = document.getElementById('poly-draw-hint');
        if (hint) {
          if (pts.length >= 3) {
            hint.textContent = 'Click start point (green square) or press Enter to finish';
          } else {
            hint.textContent = `Click next corner (${pts.length}/3+ points)`;
          }
        }
        ProjectController.renderPolygons();
      });

      viewport?.addEventListener('dblclick', (e) => {
        if (!ProjectController.polyDraw.active) return;
        e.preventDefault();
        if (ProjectController.polyDraw.points.length >= 3) {
          ProjectController.finishPolygonDraw();
        }
      });
    },

    /* ---------------- One-Click Magic Trace (Vector CAD + SlimSAM WebGPU) ---------------- */
    bindMagicTrace() {
      document.getElementById('magic-trace-btn')?.addEventListener('click', () => {
        if (ProjectController.magicTraceActive) {
          ProjectController.cancelMagicTrace();
        } else {
          ProjectController.startMagicTrace();
        }
      });
      document.getElementById('magic-trace-cancel-btn')?.addEventListener('click', () => {
        ProjectController.cancelMagicTrace();
      });

      const hintEl = document.getElementById('magic-trace-hint');
      const viewport = document.getElementById('map-viewport');
      viewport?.addEventListener('click', async (e) => {
        if (!ProjectController.magicTraceActive || ProjectController.polyDraw.active || ProjectController.magicTraceBusy) return;
        const transformEl = document.getElementById('map-transform');
        const rect = transformEl?.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) return;

        const xPct = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)) * 100) / 100;
        const yPct = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)) * 100) / 100;

        ProjectController.magicTraceBusy = true;
        try {
          const traced = await ProjectController.traceBestBoundaryAt(xPct, yPct, {
            onStatus: (msg) => {
              if (hintEl) hintEl.textContent = msg;
            },
          });
          if (!traced) {
            App.toast('No shape found at this point — try another click or use Draw Zone.', 'error');
            return;
          }

          const targetId = ProjectController.magicTraceTargetAssetId;
          ProjectController.cancelMagicTrace();
          const srcLabel = traced.source === 'vector-pdf'
            ? 'Vector PDF'
            : (traced.source || 'SlimSAM AI').toUpperCase();

          if (targetId) {
            const targetAsset = ProjectController.assets.find((a) => a.id === targetId);
            if (targetAsset) {
              await ProjectController.saveTracedShapeForAsset(targetAsset, traced);
              ProjectController.renderSidebar();
              ProjectController.renderHotspots();
              if (ProjectController.editMode) ProjectController.openEditor(targetAsset.id);
              App.toast(`Aligned "${targetAsset.title}" (${traced.polygon.length} corners, ${srcLabel})!`, 'success');
              return;
            }
          }

          ProjectController.pendingPolygon = {
            points: traced.polygon,
            bbox: traced.bbox,
          };
          ProjectController.openAddAssetModal({ keepPolygon: true });
          App.toast(`Traced ${traced.polygon.length}-corner polygon (${srcLabel})! Enter zone details to save.`, 'success');
        } catch (err) {
          if (hintEl) hintEl.textContent = 'SlimSAM error — check connection or use Draw Zone';
          App.toast(err.message || 'Failed to segment shape', 'error');
        } finally {
          ProjectController.magicTraceBusy = false;
        }
      });
    },

    startMagicTrace(targetAssetId = null) {
      ProjectController.cancelPolygonDraw();
      ProjectController.magicTraceActive = true;
      ProjectController.magicTraceTargetAssetId = targetAssetId || null;
      const targetAsset = targetAssetId ? ProjectController.assets.find((a) => a.id === targetAssetId) : null;
      document.getElementById('magic-trace-bar').hidden = false;
      const hintEl = document.getElementById('magic-trace-hint');
      const imgEl = document.getElementById('map-image');
      if (hintEl) {
        hintEl.textContent = targetAsset
          ? `Click inside the shape on the map to align "${targetAsset.title}" (Vector CAD / SlimSAM AI)`
          : window.SlimSamSegmenter?.isReady()
            ? `SlimSAM (${window.SlimSamSegmenter.getDevice().toUpperCase()}) ready — click inside any plot, room, or roof`
            : 'Click inside any plot, room, or roof to trace with Vector CAD / SlimSAM AI';
      }
      if (!targetAsset && window.SlimSamSegmenter && !window.SlimSamSegmenter.isReady() && imgEl?.complete && imgEl.naturalWidth > 0) {
        window.SlimSamSegmenter.ensureImageEmbeddings(imgEl, (msg) => {
          if (ProjectController.magicTraceActive && hintEl && !ProjectController.magicTraceTargetAssetId) hintEl.textContent = msg;
        }).then(() => {
          if (ProjectController.magicTraceActive && hintEl && !ProjectController.magicTraceTargetAssetId) {
            hintEl.textContent = `SlimSAM (${window.SlimSamSegmenter.getDevice().toUpperCase()}) ready — click inside any plot, room, or roof`;
          }
        }).catch(() => {});
      }
      document.getElementById('map-viewport')?.classList.add('magic-tracing');
      const btn = document.getElementById('magic-trace-btn');
      btn?.classList.add('btn-primary');
      btn?.classList.remove('btn-ghost');
    },

    cancelMagicTrace() {
      ProjectController.magicTraceActive = false;
      ProjectController.magicTraceBusy = false;
      ProjectController.magicTraceTargetAssetId = null;
      const bar = document.getElementById('magic-trace-bar');
      if (bar) bar.hidden = true;
      document.getElementById('map-viewport')?.classList.remove('magic-tracing');
      const btn = document.getElementById('magic-trace-btn');
      btn?.classList.remove('btn-primary');
      btn?.classList.add('btn-ghost');
    },

    cycleSelectedAsset(dir = 1) {
      if (!ProjectController.assets.length) return;
      const idx = ProjectController.assets.findIndex((a) => a.id === ProjectController.selectedAssetId);
      const nextIdx = idx < 0
        ? (dir > 0 ? 0 : ProjectController.assets.length - 1)
        : (idx + dir + ProjectController.assets.length) % ProjectController.assets.length;
      const asset = ProjectController.assets[nextIdx];
      if (!asset) return;
      const hs = document.querySelector(`.hotspot[data-asset-id="${CSS.escape(asset.id)}"]`);
      ProjectController.selectAsset(asset.id, !ProjectController.editMode, hs);
    },

    nudgeSelectedAsset(dxPct, dyPct) {
      const asset = ProjectController.assets.find((a) => a.id === ProjectController.selectedAssetId);
      if (!asset) return;
      if (Array.isArray(asset.polygon) && asset.polygon.length >= 3) {
        asset.polygon = asset.polygon.map(([px, py]) => [
          Math.round(Math.max(0, Math.min(100, px + dxPct)) * 100) / 100,
          Math.round(Math.max(0, Math.min(100, py + dyPct)) * 100) / 100,
        ]);
        const bbox = ProjectController.computePolyBbox(asset.polygon);
        asset.x = bbox.x;
        asset.y = bbox.y;
        asset.w = bbox.w;
        asset.h = bbox.h;
      } else {
        const curX = ProjectController.parsePct(asset.x, 10);
        const curY = ProjectController.parsePct(asset.y, 10);
        const curW = ProjectController.parsePct(asset.w, 12);
        const curH = ProjectController.parsePct(asset.h, 10);
        asset.x = `${Math.max(0, Math.min(100 - curW, curX + dxPct)).toFixed(2)}%`;
        asset.y = `${Math.max(0, Math.min(100 - curH, curY + dyPct)).toFixed(2)}%`;
      }
      ProjectController.renderHotspots();
      if (ProjectController.editMode) ProjectController.syncEditorInputs(asset);
      clearTimeout(ProjectController._nudgeSaveTimer);
      ProjectController._nudgeSaveTimer = setTimeout(() => {
        if (!ProjectController.project) return;
        App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(asset.id)}`,
          {
            method: 'PUT',
            body: {
              x: asset.x,
              y: asset.y,
              w: asset.w,
              h: asset.h,
              polygon: asset.shape === 'polygon' ? asset.polygon : undefined,
            },
          }
        ).catch(() => {});
      }, 220);
    },

    bindKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        const projView = document.getElementById('project-view');
        if (!projView || projView.hidden || !ProjectController.project) return;

        const tag = (e.target && e.target.tagName) || '';
        const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable;
        if (isTyping) return;

        const viewerOpen = !document.getElementById('viewer-overlay')?.hidden;
        if (viewerOpen) return;

        const openModal = document.querySelector('.modal-overlay:not([hidden])');
        const key = e.key.toLowerCase();

        // Escape cancels active tools, exits presentation mode, or closes top modal
        if (e.key === 'Escape') {
          ProjectController.closeCadGripMenu();
          if (openModal) return; // Handled by App global Escape
          if (ProjectController.polyDraw.active) {
            e.preventDefault();
            ProjectController.cancelPolygonDraw();
            return;
          }
          if (ProjectController.magicTraceActive) {
            e.preventDefault();
            ProjectController.cancelMagicTrace();
            return;
          }
          if (ProjectController.presentMode) {
            e.preventDefault();
            ProjectController.setPresentationMode(false);
            return;
          }
          if (ProjectController.selectedAssetId) {
            ProjectController.selectedAssetId = null;
            document.getElementById('editor-panel').hidden = true;
            document.getElementById('doc-popup').hidden = true;
            ProjectController.renderSidebar();
            ProjectController.renderHotspots();
          }
          return;
        }

        // Toggle Shortcuts sheet even if shortcuts modal itself is open
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
          const modal = document.getElementById('shortcuts-modal');
          if (modal && (!openModal || openModal === modal)) {
            e.preventDefault();
            modal.hidden = !modal.hidden;
          }
          return;
        }

        if (openModal) return;

        // While drawing polygon: Undo (U / Ctrl+Z), Toggle Ortho (O) & Finish (Enter)
        if (ProjectController.polyDraw.active) {
          if (key === 'o') {
            e.preventDefault();
            ProjectController.toggleOrthoMode();
            return;
          }
          if (key === 'u' || ((e.ctrlKey || e.metaKey) && key === 'z')) {
            e.preventDefault();
            document.getElementById('poly-undo-btn')?.click();
            return;
          }
          if (e.key === 'Enter' && ProjectController.polyDraw.points.length >= 3) {
            e.preventDefault();
            ProjectController.finishPolygonDraw();
            return;
          }
        }

        if (e.ctrlKey || e.metaKey || e.altKey) return;

        if ((e.key === 'Delete' || e.key === 'Backspace') && ProjectController.editMode && !ProjectController.presentMode && ProjectController.selectedAssetId) {
          e.preventDefault();
          ProjectController.deleteAssetById(ProjectController.selectedAssetId);
          return;
        }

        // Arrow keys: nudge selected asset in Edit Mode, otherwise pan viewport
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          const stepPct = e.shiftKey ? 1.5 : 0.4;
          if (ProjectController.editMode && ProjectController.selectedAssetId && !ProjectController.presentMode) {
            const dx = e.key === 'ArrowRight' ? stepPct : e.key === 'ArrowLeft' ? -stepPct : 0;
            const dy = e.key === 'ArrowDown' ? stepPct : e.key === 'ArrowUp' ? -stepPct : 0;
            ProjectController.nudgeSelectedAsset(dx, dy);
          } else if (window.MapController) {
            const pan = e.shiftKey ? 110 : 45;
            if (e.key === 'ArrowLeft') window.MapController.state.translateX += pan;
            if (e.key === 'ArrowRight') window.MapController.state.translateX -= pan;
            if (e.key === 'ArrowUp') window.MapController.state.translateY += pan;
            if (e.key === 'ArrowDown') window.MapController.state.translateY -= pan;
            window.MapController.applyTransform();
          }
          return;
        }

        switch (key) {
          case 'v':
            ProjectController.cancelPolygonDraw();
            ProjectController.cancelMagicTrace();
            break;
          case 'e':
            if (!ProjectController.presentMode) {
              ProjectController.setEditMode(!ProjectController.editMode);
            }
            break;
          case 'p':
          case 'd':
            if (!ProjectController.presentMode) {
              if (ProjectController.polyDraw.active) ProjectController.cancelPolygonDraw();
              else ProjectController.startPolygonDraw(null);
            }
            break;
          case 't':
            if (!ProjectController.presentMode) {
              if (ProjectController.magicTraceActive && !ProjectController.magicTraceTargetAssetId) ProjectController.cancelMagicTrace();
              else ProjectController.startMagicTrace(null);
            }
            break;
          case 'a':
            if (!ProjectController.presentMode) {
              if (ProjectController.selectedAssetId) {
                document.getElementById('doc-popup').hidden = true;
                ProjectController.startMagicTrace(ProjectController.selectedAssetId);
              } else {
                App.toast('Select an asset first (click on map or press [ / ]), then press A to align its shape.', 'info');
              }
            }
            break;
          case 's':
            if (!ProjectController.presentMode && ProjectController.selectedAssetId) {
              ProjectController.snapAssetToMapBoundary(ProjectController.selectedAssetId);
            }
            break;
          case 'n':
            if (!ProjectController.presentMode) {
              ProjectController.openAddAssetModal();
            }
            break;
          case 'l':
            document.getElementById('toggle-labels-btn')?.click();
            break;
          case 'm':
            if (!ProjectController.presentMode) {
              document.getElementById('smart-assist-btn')?.click();
            }
            break;
          case 'k':
            ProjectController.openScheduleModal();
            break;
          case 'g':
            ProjectController.openGalleryModal();
            break;
          case 'f':
          case '0':
            window.MapController?.fit();
            break;
          case '=':
          case '+':
            window.MapController?.zoomBy(0.2);
            break;
          case '-':
            window.MapController?.zoomBy(-0.2);
            break;
          case '[':
            ProjectController.cycleSelectedAsset(-1);
            break;
          case ']':
            ProjectController.cycleSelectedAsset(1);
            break;
          case '1':
            App.setTheme('studio');
            break;
          case '2':
            App.setTheme('blueprint');
            break;
          case '3':
            App.setTheme('cad-dark');
            break;
          default:
            break;
        }
      });
    },

    startPolygonDraw(editingAssetId = null) {
      ProjectController.closeSmartAssist();
      document.getElementById('doc-popup').hidden = true;
      ProjectController.polyDraw = {
        active: true,
        points: [],
        editingAssetId,
        ortho: false,
        currentMouse: null,
        snapped: false,
      };
      document.getElementById('map-viewport')?.classList.add('poly-drawing');
      const bar = document.getElementById('poly-draw-bar');
      if (bar) bar.hidden = false;
      const finishBtn = document.getElementById('poly-finish-btn');
      if (finishBtn) finishBtn.disabled = true;
      const orthoBtn = document.getElementById('poly-ortho-btn');
      if (orthoBtn) {
        orthoBtn.textContent = 'Ortho: OFF';
        orthoBtn.classList.remove('btn-primary');
        orthoBtn.classList.add('btn-ghost');
      }
      const overlay = document.getElementById('cad-crosshair-overlay');
      if (overlay) overlay.hidden = false;
      const snapMarker = document.getElementById('cad-snap-marker');
      if (snapMarker) snapMarker.hidden = true;
      const readout = document.getElementById('cad-dynamic-readout');
      if (readout) readout.hidden = true;

      document.getElementById('poly-draw-hint').textContent = editingAssetId
        ? 'Redrawing plot boundary — click corners (3+ points)'
        : 'Click plot corners on map (3+ points)';
      ProjectController.renderPolygons();
    },

    cancelPolygonDraw() {
      ProjectController.polyDraw = {
        active: false,
        points: [],
        editingAssetId: null,
        ortho: false,
        currentMouse: null,
        snapped: false,
      };
      document.getElementById('map-viewport')?.classList.remove('poly-drawing');
      const bar = document.getElementById('poly-draw-bar');
      if (bar) bar.hidden = true;
      const overlay = document.getElementById('cad-crosshair-overlay');
      if (overlay) overlay.hidden = true;
      const snapMarker = document.getElementById('cad-snap-marker');
      if (snapMarker) snapMarker.hidden = true;
      const readout = document.getElementById('cad-dynamic-readout');
      if (readout) readout.hidden = true;
      ProjectController.renderPolygons();
    },

    computePolyBbox(points) {
      let minX = 100, minY = 100, maxX = 0, maxY = 0;
      for (const [x, y] of points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return {
        x: minX.toFixed(1) + '%',
        y: minY.toFixed(1) + '%',
        w: Math.max(3, maxX - minX).toFixed(1) + '%',
        h: Math.max(3, maxY - minY).toFixed(1) + '%',
      };
    },

    async finishPolygonDraw() {
      const pts = ProjectController.polyDraw.points.slice();
      const editId = ProjectController.polyDraw.editingAssetId;
      if (pts.length < 3) return;
      const bbox = ProjectController.computePolyBbox(pts);
      ProjectController.cancelPolygonDraw();

      if (editId) {
        const asset = ProjectController.assets.find((a) => a.id === editId);
        if (!asset) return;
        try {
          const res = await App.api(
            `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(editId)}`,
            {
              method: 'PUT',
              body: { shape: 'polygon', polygon: pts, ...bbox },
            }
          );
          if (res && res.asset) Object.assign(asset, res.asset);
          ProjectController.renderHotspots();
          ProjectController.openEditor(editId);
          App.toast('Polygon plot boundary updated', 'success');
        } catch (err) {
          App.toast(err.message || 'Failed to update polygon', 'error');
        }
      } else {
        ProjectController.pendingPolygon = { points: pts, bbox };
        ProjectController.openAddAssetModal({ keepPolygon: true });
      }
    },

    /* ---------------- Smart PDF Site Plan Assist ---------------- */
    bindSmartAssist() {
      document.getElementById('smart-assist-btn')?.addEventListener('click', () => {
        if (ProjectController.smartAssistOpen) {
          ProjectController.closeSmartAssist();
        } else {
          ProjectController.openSmartAssist();
        }
      });
      document.getElementById('close-smart-assist')?.addEventListener('click', () => {
        ProjectController.closeSmartAssist();
      });
      document.getElementById('sa-rescan-btn')?.addEventListener('click', () => {
        ProjectController.scanSitePlanPdf();
      });
      document.getElementById('sa-resnap-btn')?.addEventListener('click', () => {
        ProjectController.resnapAllAssets();
      });
      document.getElementById('sa-select-all-btn')?.addEventListener('click', () => {
        const allSelected = ProjectController.smartSuggestions.every((s) => s.selected);
        ProjectController.smartSuggestions.forEach((s) => { s.selected = !allSelected; });
        ProjectController.renderSmartAssistList();
        ProjectController.renderHotspots();
      });
      document.getElementById('sa-clear-all-btn')?.addEventListener('click', async () => {
        if (ProjectController.assets.length === 0) return;
        const ok = await App.confirm(
          'Clear All Zones',
          `Remove all ${ProjectController.assets.length} zone(s) from this site map so you can re-place them cleanly? Project files will stay safe.`,
          'Clear Zones'
        );
        if (!ok) return;
        try {
          await Promise.all(
            ProjectController.assets.map((a) =>
              App.api(`/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/${encodeURIComponent(a.id)}`, {
                method: 'DELETE',
              })
            )
          );
          ProjectController.assets = [];
          ProjectController.files.forEach((f) => { f.asset_id = null; });
          ProjectController.selectedAssetId = null;
          if (ProjectController.smartSuggestions.length > 0) {
            ProjectController.smartSuggestions.forEach((s) => {
              s.selected = s.text.length <= 40;
            });
            ProjectController.renderSmartAssistList();
          }
          ProjectController.renderSidebar();
          ProjectController.renderHotspots();
          App.toast('All map zones cleared', 'success');
        } catch (err) {
          App.toast(err.message || 'Failed to clear zones', 'error');
        }
      });
      document.getElementById('sa-apply-btn')?.addEventListener('click', () => {
        ProjectController.applySmartSuggestions();
      });
    },

    async resnapAllAssets() {
      if (!ProjectController.project || ProjectController.assets.length === 0) {
        App.toast('No assets on map to align', 'error');
        return;
      }

      const detected = Array.isArray(ProjectController.project.detected_labels)
        ? ProjectController.project.detected_labels
        : [];
      let updatedCount = 0;
      App.toast('Aligning asset boundaries via Vector PDF / SlimSAM…', 'info');

      for (const asset of ProjectController.assets) {
        if (asset.shape === 'road' || asset.shape === 'bridge') continue;
        const matchedLbl = detected.find(
          (l) => l.text && asset.title && l.text.toLowerCase() === asset.title.toLowerCase()
        );
        const cx = matchedLbl
          ? matchedLbl.xPct
          : ProjectController.parsePct(asset.x, 10) + ProjectController.parsePct(asset.w, 12) / 2;
        const cy = matchedLbl
          ? matchedLbl.yPct
          : ProjectController.parsePct(asset.y, 10) + ProjectController.parsePct(asset.h, 10) / 2;

        let traced = null;
        try {
          traced = await ProjectController.traceBestBoundaryAt(cx, cy);
        } catch {
          traced = null;
        }
        if (!traced) continue;

        try {
          await ProjectController.saveTracedShapeForAsset(asset, traced);
          updatedCount++;
        } catch {
          // Continue aligning remaining assets
        }
      }

      ProjectController.renderSidebar();
      ProjectController.renderHotspots();
      App.toast(
        updatedCount > 0
          ? `Aligned ${updatedCount} asset shape(s) to map boundaries`
          : 'No enclosed map boundaries matched existing asset centers',
        updatedCount > 0 ? 'success' : 'info'
      );
    },

    async saveDetectedLabels(labels) {
      if (!ProjectController.project) return;
      try {
        const res = await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/detected-labels`,
          { method: 'PUT', body: { labels } }
        );
        ProjectController.project.detected_labels = (res && res.detected_labels) || labels;
      } catch {
        // Non-fatal
      }
    },

    loadSuggestionsFromLabels(labels, siteAreaText = '', groundCoverageText = '', optionText = '') {
      ProjectController.smartSiteArea = siteAreaText || '';
      ProjectController.smartGroundCoverage = groundCoverageText || '';
      ProjectController.smartOptionText = optionText || '';
      const existingTitles = new Set(ProjectController.assets.map((a) => (a.title || '').toLowerCase()));

      ProjectController.smartSuggestions = (labels || []).map((lbl, idx) => {
        const matched = window.SmartAssist
          ? window.SmartAssist.matchFilesToLabel(lbl.text, ProjectController.files)
          : [];
        const alreadyExists = existingTitles.has(lbl.text.toLowerCase());
        const shouldTrace = (lbl) =>
          lbl.zone_type !== 'road' &&
          !(lbl.zone_type === 'transit' && /BRIDGE/i.test(lbl.text));

        let traced = null;
        let vectorSource = null;
        if (shouldTrace(lbl)) {
          if (Array.isArray(lbl.vectorPolygon) && lbl.vectorPolygon.length >= 3 && lbl.vectorBbox) {
            traced = { polygon: lbl.vectorPolygon, bbox: lbl.vectorBbox, source: lbl.vectorSource || 'vector-pdf' };
          } else if (ProjectController._cachedPdfVectors && window.SmartAssist?.findVectorPolygonAt) {
            traced = window.SmartAssist.findVectorPolygonAt(ProjectController._cachedPdfVectors, lbl.xPct, lbl.yPct);
          }
          if (traced) vectorSource = traced.source || 'vector-pdf';
        }
        return {
          idx,
          selected: !alreadyExists && lbl.text.length <= 40,
          text: lbl.text,
          area: lbl.area || '',
          zone_type: lbl.zone_type || 'building',
          icon: lbl.icon || '🏢',
          shape: traced ? 'polygon' : (lbl.shape || 'rect'),
          polygon: traced ? traced.polygon : null,
          bbox: traced ? traced.bbox : null,
          vectorSource,
          xPct: lbl.xPct,
          yPct: lbl.yPct,
          matchedFiles: matched,
        };
      });
    },

    async openSmartAssist() {
      document.getElementById('editor-panel').hidden = true;
      ProjectController.smartAssistOpen = true;
      document.getElementById('smart-assist-panel').hidden = false;

      if (
        ProjectController.smartSuggestions.length === 0 &&
        Array.isArray(ProjectController.project?.detected_labels) &&
        ProjectController.project.detected_labels.length > 0
      ) {
        ProjectController.loadSuggestionsFromLabels(ProjectController.project.detected_labels);
      }

      if (ProjectController.smartSuggestions.length === 0) {
        await ProjectController.scanSitePlanPdf();
      } else {
        ProjectController.renderSmartAssistList();
        ProjectController.renderHotspots();
      }
    },

    closeSmartAssist() {
      ProjectController.smartAssistOpen = false;
      const panel = document.getElementById('smart-assist-panel');
      if (panel) panel.hidden = true;
      ProjectController.renderHotspots();
    },

    async scanSitePlanPdf() {
      if (!ProjectController.project || !window.SmartAssist) return;
      const summaryEl = document.getElementById('smart-assist-summary');
      const listEl = document.getElementById('smart-assist-list');

      const sitePdf = ProjectController.getSitePlanPdfFile();

      if (!sitePdf) {
        const mapImg = document.getElementById('map-image');
        if (mapImg && mapImg.naturalWidth && window.SmartAssist?.extractRasterColorParcels) {
          if (summaryEl) summaryEl.textContent = 'Scanning master plan image colors…';
          const rasterParcels = window.SmartAssist.extractRasterColorParcels(mapImg);
          if (rasterParcels.length > 0) {
            let bldgCount = 1;
            const rasterLabels = rasterParcels.map((p) => {
              const cx = parseFloat(p.bbox.x) + parseFloat(p.bbox.w) / 2;
              const cy = parseFloat(p.bbox.y) + parseFloat(p.bbox.h) / 2;
              const isBldg = p.category === 'building';
              return {
                text: isBldg ? `Building 0${bldgCount++}` : 'OSR / Green Belt',
                area: '',
                zone_type: isBldg ? 'building' : 'landscape',
                icon: isBldg ? '🏢' : '🌳',
                shape: 'polygon',
                polygon: p.polygon,
                vectorPolygon: p.polygon,
                vectorBbox: p.bbox,
                vectorSource: 'raster-color',
                xPct: Math.round(cx * 100) / 100,
                yPct: Math.round(cy * 100) / 100,
                selected: true,
              };
            });
            await ProjectController.saveDetectedLabels(rasterLabels);
            ProjectController.loadSuggestionsFromLabels(rasterLabels, '', '', '');
            ProjectController.renderSmartAssistList();
            ProjectController.renderHotspots();
            return;
          }
        }
        if (summaryEl) {
          summaryEl.innerHTML = 'No PDF site plan found yet. Upload a CAD-exported PDF via <strong>Upload Map</strong> or <strong>Import Folder</strong> to extract exact plot labels &amp; SQM areas.';
        }
        if (listEl) listEl.innerHTML = '';
        return;
      }

      if (summaryEl) summaryEl.textContent = `Scanning ${sitePdf.original_name}…`;
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/files/${encodeURIComponent(sitePdf.id)}/download?inline=1`,
          { credentials: 'same-origin' }
        );
        if (!res.ok) throw new Error('Could not read PDF');
        const buf = await res.arrayBuffer();
        const extracted = await window.SmartAssist.extractPdfLabelsFromBuffer(buf);
        ProjectController._cachedPdfVectors = extracted.vectorGeometry || null;
        await ProjectController.saveDetectedLabels(extracted.labels);
        ProjectController.loadSuggestionsFromLabels(
          extracted.labels,
          extracted.siteAreaText,
          extracted.groundCoverageText,
          extracted.optionText
        );
        ProjectController.renderSmartAssistList();
        ProjectController.renderHotspots();
      } catch (err) {
        if (summaryEl) summaryEl.textContent = err.message || 'Failed to scan PDF.';
      }
    },

    renderSmartAssistList() {
      const summaryEl = document.getElementById('smart-assist-summary');
      const listEl = document.getElementById('smart-assist-list');
      if (!summaryEl || !listEl) return;

      const selectedCount = ProjectController.smartSuggestions.filter((s) => s.selected).length;
      summaryEl.innerHTML = `
        <div style="font-weight:700;color:var(--text);margin-bottom:3px;display:flex;align-items:center;gap:6px;">
          <span>🎯</span> Master Plan Classified
        </div>
        ${ProjectController.smartSiteArea ? `<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:2px;"><strong>Site Area:</strong> ${App.escapeHtml(ProjectController.smartSiteArea)}</div>` : ''}
        ${ProjectController.smartGroundCoverage ? `<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:2px;"><strong>Ground Coverage:</strong> ${App.escapeHtml(ProjectController.smartGroundCoverage)}</div>` : ''}
        <div style="margin-top:4px;font-size:11.5px;">
          Detected <strong>${ProjectController.smartSuggestions.length}</strong> site parcel(s) &amp; zones (${selectedCount} selected).
        </div>
      `;

      if (ProjectController.smartSuggestions.length === 0) {
        listEl.innerHTML = '<div class="doc-empty">No site parcels or architectural features detected. Use <strong>Draw Zone</strong> or <strong>+ Add Asset</strong>.</div>';
        return;
      }

      const groups = [
        { title: '🏢 Buildings & Warehouses', filter: (s) => s.zone_type === 'building' },
        { title: '🌳 Landscaping & Green Belts', filter: (s) => s.zone_type === 'landscape' },
        { title: '⚡ Utilities & Infrastructure', filter: (s) => s.zone_type === 'utility' || s.zone_type === 'civic' },
        { title: '🛣️ Circulation & Roads', filter: (s) => s.zone_type === 'road' || s.zone_type === 'transit' },
        { title: '📍 Other Site Zones', filter: (s) => !['building', 'landscape', 'utility', 'civic', 'road', 'transit'].includes(s.zone_type) },
      ];

      let html = '';
      for (const grp of groups) {
        const items = ProjectController.smartSuggestions.filter(grp.filter);
        if (items.length === 0) continue;
        html += `<div style="font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin:10px 0 4px 2px;">${grp.title} (${items.length})</div>`;
        html += items
          .map((s) => {
            const i = s.idx;
            const matchCount = s.matchedFiles ? s.matchedFiles.length : 0;
            return `
              <div class="sa-item" data-sa-idx="${i}">
                <div class="sa-item-top">
                  <input type="checkbox" data-sa-check="${i}" ${s.selected ? 'checked' : ''}>
                  <span>${App.escapeHtml(s.icon)}</span>
                  <input type="text" class="sa-item-title" data-sa-title="${i}" value="${App.escapeHtml(s.text)}">
                </div>
                <div class="sa-item-meta">
                  <span>@ ${s.xPct.toFixed(0)}%, ${s.yPct.toFixed(0)}%</span>
                  ${s.polygon ? `<span class="file-badge-cat" style="background:var(--accent-soft);color:var(--accent);">${s.vectorSource === 'vector-pdf' ? 'Vector CAD' : (s.vectorSource === 'raster-color' ? 'Color Parcel' : 'Polygon')} (${s.polygon.length} pts)</span>` : '<span class="file-badge-cat">Callout</span>'}
                  ${s.area ? `<span class="file-badge-cat">${App.escapeHtml(s.area)}</span>` : ''}
                  ${matchCount > 0 ? `<span class="status-pill status-Approved">${matchCount} file${matchCount > 1 ? 's' : ''}</span>` : ''}
                </div>
              </div>
            `;
          })
          .join('');
      }

      listEl.innerHTML = html;

      listEl.querySelectorAll('[data-sa-check]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const idx = Number(cb.dataset.saCheck);
          if (ProjectController.smartSuggestions[idx]) {
            ProjectController.smartSuggestions[idx].selected = cb.checked;
            ProjectController.renderHotspots();
          }
        });
      });

      listEl.querySelectorAll('[data-sa-title]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const idx = Number(inp.dataset.saTitle);
          if (ProjectController.smartSuggestions[idx]) {
            ProjectController.smartSuggestions[idx].text = inp.value;
          }
        });
      });
    },

    async applySmartSuggestions() {
      const chosen = ProjectController.smartSuggestions.filter((s) => s.selected && s.text.trim());
      if (chosen.length === 0) {
        App.toast('Select at least one detected label first.', 'error');
        return;
      }

      const payload = chosen.map((s) => {
        if (Array.isArray(s.polygon) && s.polygon.length >= 3 && s.bbox) {
          return {
            title: s.text.trim(),
            icon: s.icon,
            shape: 'polygon',
            polygon: s.polygon,
            x: s.bbox.x,
            y: s.bbox.y,
            w: s.bbox.w,
            h: s.bbox.h,
            area: s.area || '',
            status: 'WIP',
            matched_file_ids: s.matchedFiles.map((f) => f.id),
          };
        }
        const isCallout = s.shape === 'road' || s.shape === 'bridge';
        const w = isCallout ? 11 : 12;
        const h = isCallout ? 4 : 9;
        const x = Math.max(0, Math.min(100 - w, s.xPct - w / 2));
        const y = Math.max(0, Math.min(100 - h, s.yPct - h / 2));
        return {
          title: s.text.trim(),
          icon: s.icon,
          shape: s.shape,
          x: x.toFixed(1) + '%',
          y: y.toFixed(1) + '%',
          w: w + '%',
          h: h + '%',
          area: s.area || '',
          status: 'WIP',
          matched_file_ids: s.matchedFiles.map((f) => f.id),
        };
      });

      try {
        const res = await App.api(
          `/api/projects/${encodeURIComponent(ProjectController.project.id)}/assets/batch`,
          { method: 'POST', body: { assets: payload } }
        );
        if (res && res.assets) {
          ProjectController.assets.push(...res.assets);
        }
        if (res && Array.isArray(res.linked_files)) {
          res.linked_files.forEach((lf) => {
            const idx = ProjectController.files.findIndex((f) => f.id === lf.id);
            if (idx >= 0) ProjectController.files[idx] = lf;
          });
        }
        ProjectController.closeSmartAssist();
        ProjectController.renderSidebar();
        ProjectController.renderHotspots();
        App.toast(`Created ${payload.length} zone(s) from site plan!`, 'success');
      } catch (err) {
        App.toast(err.message || 'Failed to apply zones', 'error');
      }
    },

    /* ---------------- Presentation Mode ---------------- */
    setPresentationMode(enabled) {
      ProjectController.presentMode = !!enabled;
      const view = document.getElementById('project-view');
      const banner = document.getElementById('present-banner');
      if (view) view.classList.toggle('present-mode', ProjectController.presentMode);
      if (banner) banner.hidden = !ProjectController.presentMode;
      if (ProjectController.presentMode) {
        ProjectController.setEditMode(false);
        ProjectController.cancelPolygonDraw();
        ProjectController.closeSmartAssist();
        if (window.MapController) window.MapController.fit();
      }
    },

    /* ---------------- Executive Schedule & Audit Modal ---------------- */
    async openScheduleModal() {
      if (!ProjectController.project) return;
      const body = document.getElementById('schedule-modal-body');
      const modal = document.getElementById('schedule-modal');
      if (!body || !modal) return;

      const assets = ProjectController.assets;
      const files = ProjectController.files;
      const approvedAssets = assets.filter((a) => a.status === 'Approved').length;
      const approvedFiles = files.filter((f) => f.status === 'Approved').length;

      let activity = [];
      try {
        const actRes = await App.api(`/api/projects/${encodeURIComponent(ProjectController.project.id)}/activity`);
        activity = (actRes && actRes.activity) || [];
      } catch {
        activity = [];
      }

      const rowsHtml = assets.length
        ? assets
            .map((a) => {
              const fCount = ProjectController.getAssetFiles(a.id).length;
              const st = a.status || 'WIP';
              return `
                <tr>
                  <td>${App.escapeHtml(a.icon || '🏢')} <strong>${App.escapeHtml(a.title)}</strong></td>
                  <td style="font-family:var(--mono);">${App.escapeHtml(a.area || '—')}</td>
                  <td><span class="status-pill status-${App.escapeHtml(st)}">${App.escapeHtml(st)}</span></td>
                  <td style="font-family:var(--mono);">${fCount}</td>
                </tr>`;
            })
            .join('')
        : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No zones defined yet.</td></tr>';

      const actHtml = activity.length
        ? activity
            .slice(0, 15)
            .map(
              (ev) => `
              <tr>
                <td><strong>${App.escapeHtml(ev.user_name || 'User')}</strong></td>
                <td style="font-family:var(--mono);">${App.escapeHtml(ev.action)}</td>
                <td>${App.escapeHtml(ev.details || '')}</td>
                <td style="font-family:var(--mono);color:var(--text-muted);">${App.escapeHtml(App.formatDate(ev.created_at))}</td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No recorded activity yet.</td></tr>';

      body.innerHTML = `
        <div class="schedule-kpis">
          <div class="schedule-kpi"><div class="schedule-kpi-val">${assets.length}</div><div class="schedule-kpi-lbl">Site Zones</div></div>
          <div class="schedule-kpi"><div class="schedule-kpi-val">${approvedAssets}</div><div class="schedule-kpi-lbl">Approved Zones</div></div>
          <div class="schedule-kpi"><div class="schedule-kpi-val">${files.length}</div><div class="schedule-kpi-lbl">Project Files</div></div>
          <div class="schedule-kpi"><div class="schedule-kpi-val">${approvedFiles}</div><div class="schedule-kpi-lbl">Approved Docs</div></div>
        </div>
        <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Zone &amp; Area Register</h4>
        <table class="schedule-table">
          <thead><tr><th>Zone</th><th>Area</th><th>Status</th><th>Files</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Recent Audit Trail</h4>
        <table class="schedule-table">
          <thead><tr><th>User</th><th>Action</th><th>Details</th><th>Date</th></tr></thead>
          <tbody>${actHtml}</tbody>
        </table>
      `;
      modal.hidden = false;
    },

    /* ---------------- Visual Renders & 3D Previews Gallery ---------------- */
    openGalleryModal() {
      if (!ProjectController.project) return;
      const body = document.getElementById('gallery-modal-body');
      const modal = document.getElementById('gallery-modal');
      if (!body || !modal) return;

      const visualFiles = ProjectController.files.filter((f) => {
        const ext = ((f.original_name || '').split('.').pop() || '').toLowerCase();
        return (
          f.thumbnail_url ||
          ['png', 'jpg', 'jpeg', 'webp', 'svg', 'tif', 'tiff', 'skp', 'skb', 'dwg', 'bak', 'pptx', 'glb', 'gltf'].includes(ext)
        );
      });

      if (visualFiles.length === 0) {
        body.innerHTML = '<div class="doc-empty">No renders, aerials, SketchUp/CAD previews, or presentations uploaded yet.</div>';
      } else {
        body.innerHTML = `<div class="gallery-grid">${visualFiles
          .map((f) => {
            const thumb = f.thumbnail_url
              ? `<img src="${App.escapeHtml(f.thumbnail_url)}" alt="${App.escapeHtml(f.label)}" loading="lazy">`
              : `<span>${ProjectController.getFileIcon(f)}</span>`;
            return `
              <div class="gallery-card" data-gal-file="${App.escapeHtml(f.id)}">
                <div class="gallery-thumb">${thumb}</div>
                <div class="gallery-info">
                  <div class="gallery-name" title="${App.escapeHtml(f.original_name)}">${App.escapeHtml(f.label || f.original_name)}</div>
                  <div class="gallery-meta">${App.escapeHtml(f.category || 'General')} • ${App.escapeHtml(App.formatBytes(f.file_size))}</div>
                </div>
              </div>
            `;
          })
          .join('')}</div>`;

        body.querySelectorAll('[data-gal-file]').forEach((card) => {
          card.addEventListener('click', () => {
            const f = ProjectController.files.find((x) => x.id === card.dataset.galFile);
            if (f && window.ViewerManager) {
              modal.hidden = true;
              window.ViewerManager.open(ProjectController.project.id, f);
            }
          });
        });
      }
      modal.hidden = false;
    },
  };

  window.ProjectController = ProjectController;
})();
