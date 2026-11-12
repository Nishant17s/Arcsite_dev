/* ==========================================================================
   ArcSite Navigator — Dashboard Controller
   ========================================================================== */

(function () {
  'use strict';

  const DashboardController = {
    projects: [],
    searchQuery: '',

    init() {
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => DashboardController.logout());
      }

      const searchInput = document.getElementById('project-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          DashboardController.searchQuery = e.target.value.trim().toLowerCase();
          DashboardController.render();
        });
      }

      const openNewModal = () => {
        document.getElementById('np-error').textContent = '';
        document.getElementById('new-project-form').reset();
        document.getElementById('new-project-modal').hidden = false;
        setTimeout(() => document.getElementById('np-name').focus(), 50);
      };

      const newBtn = document.getElementById('new-project-btn');
      const emptyBtn = document.getElementById('empty-new-btn');
      if (newBtn) newBtn.addEventListener('click', openNewModal);
      if (emptyBtn) emptyBtn.addEventListener('click', openNewModal);

      const newForm = document.getElementById('new-project-form');
      if (newForm) {
        newForm.addEventListener('submit', (e) => DashboardController.createProject(e));
      }
    },

    async load() {
      App.updateUserAvatars();
      try {
        const res = await App.api('/api/projects');
        DashboardController.projects = (res && res.projects) || [];
        DashboardController.render();
      } catch (err) {
        App.toast(err.message || 'Failed to load projects', 'error');
      }
    },

    render() {
      const grid = document.getElementById('projects-grid');
      const empty = document.getElementById('projects-empty');
      const countLabel = document.getElementById('project-count-label');

      const q = DashboardController.searchQuery;
      const filtered = DashboardController.projects.filter((p) => {
        if (!q) return true;
        return (
          (p.name || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        );
      });

      const total = DashboardController.projects.length;
      if (countLabel) {
        countLabel.textContent =
          total === 1 ? '1 active architecture project' : `${total} active architecture projects`;
      }

      if (total === 0) {
        grid.innerHTML = '';
        grid.hidden = true;
        empty.hidden = false;
        return;
      }

      empty.hidden = true;
      grid.hidden = false;

      if (filtered.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align:center; padding: 48px 16px; color: var(--text-muted);">
            No projects match "${App.escapeHtml(DashboardController.searchQuery)}".
          </div>`;
        return;
      }

      grid.innerHTML = filtered
        .map((p) => {
          const assetCount = Number(p.asset_count ?? p.assetCount ?? 0);
          const fileCount = Number(p.file_count ?? p.fileCount ?? 0);
          const dateStr = App.formatDate(p.created_at);
          const desc = p.description
            ? App.escapeHtml(p.description)
            : '<span style="color:var(--text-muted);font-style:italic">No description provided</span>';

          return `
            <div class="project-card" data-project-id="${App.escapeHtml(p.id)}">
              <div class="project-card-top">
                <div class="project-card-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/>
                  </svg>
                </div>
                <button class="btn btn-ghost btn-icon btn-xs project-card-delete" data-delete-id="${App.escapeHtml(p.id)}" title="Delete project">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
              </div>
              <div>
                <h3 class="project-card-title">${App.escapeHtml(p.name)}</h3>
                <p class="project-card-desc">${desc}</p>
              </div>
              <div class="project-card-meta">
                <div class="project-card-stats">
                  <span class="project-stat" title="Assets">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    ${assetCount} ${assetCount === 1 ? 'Zone' : 'Zones'}
                  </span>
                  <span class="project-stat" title="Files">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    ${fileCount} ${fileCount === 1 ? 'File' : 'Files'}
                  </span>
                </div>
                <span class="project-card-date">${App.escapeHtml(dateStr)}</span>
              </div>
            </div>
          `;
        })
        .join('');

      grid.querySelectorAll('.project-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          const delBtn = e.target.closest('[data-delete-id]');
          if (delBtn) {
            e.stopPropagation();
            const id = delBtn.dataset.deleteId;
            const proj = DashboardController.projects.find((x) => x.id === id);
            DashboardController.deleteProject(id, proj ? proj.name : 'this project');
            return;
          }
          const id = card.dataset.projectId;
          App.navigate(`#/project/${encodeURIComponent(id)}`);
        });
      });
    },

    async createProject(e) {
      e.preventDefault();
      const name = document.getElementById('np-name').value.trim();
      const description = document.getElementById('np-desc').value.trim();
      const errEl = document.getElementById('np-error');
      errEl.textContent = '';

      if (!name) {
        errEl.textContent = 'Project name is required.';
        return;
      }

      try {
        const res = await App.api('/api/projects', {
          method: 'POST',
          body: { name, description },
        });
        document.getElementById('new-project-modal').hidden = true;
        App.toast('Project created!', 'success');
        if (res && res.project && res.project.id) {
          App.navigate(`#/project/${encodeURIComponent(res.project.id)}`);
        } else {
          await DashboardController.load();
        }
      } catch (err) {
        errEl.textContent = err.message || 'Failed to create project.';
      }
    },

    async deleteProject(id, name) {
      const ok = await App.confirm(
        'Delete Project',
        `Are you sure you want to delete "${name}"? All assets and files inside it will be permanently removed.`,
        'Delete Project'
      );
      if (!ok) return;

      try {
        await App.api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        DashboardController.projects = DashboardController.projects.filter((p) => p.id !== id);
        DashboardController.render();
        App.toast('Project deleted', 'success');
      } catch (err) {
        App.toast(err.message || 'Failed to delete project', 'error');
      }
    },

    async logout() {
      try {
        await App.api('/api/auth/logout', { method: 'POST', skipAuthRedirect: true });
      } catch {
        // Ignore network errors on logout
      }
      App.user = null;
      App.toast('Logged out', 'info');
      App.navigate('#/login');
    },
  };

  window.DashboardController = DashboardController;
})();
