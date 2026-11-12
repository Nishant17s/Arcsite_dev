/* ==========================================================================
   ArcSite Navigator — Main Application Controller (Router, API, Helpers)
   ========================================================================== */

(function () {
  'use strict';

  const App = {
    user: null,
    currentRoute: null,
    confirmResolve: null,

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    getInitials(name) {
      if (!name) return '?';
      const parts = String(name).trim().split(/\s+/);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    formatDate(iso) {
      if (!iso) return '—';
      try {
        const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso + 'Z');
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      } catch {
        return String(iso);
      }
    },

    toast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(16px)';
        el.style.transition = 'all 200ms ease';
        setTimeout(() => el.remove(), 220);
      }, 3400);
    },

    async api(url, options = {}) {
      const opts = {
        credentials: 'same-origin',
        ...options,
      };
      if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
        opts.headers = {
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
        };
        opts.body = JSON.stringify(opts.body);
      }
      const res = await fetch(url, opts);
      let data = null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json().catch(() => null);
      }
      if (res.status === 401 && !opts.skipAuthRedirect) {
        App.user = null;
        App.navigate('#/login');
        throw new Error((data && data.error) || 'Session expired. Please sign in.');
      }
      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    },

    confirm(title, message, yesLabel = 'Delete') {
      return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        document.getElementById('confirm-title').textContent = title || 'Confirm';
        document.getElementById('confirm-message').textContent = message || 'Are you sure?';
        const yesBtn = document.getElementById('confirm-yes');
        yesBtn.textContent = yesLabel;
        App.confirmResolve = resolve;
        modal.hidden = false;
      });
    },

    closeConfirm(result) {
      const modal = document.getElementById('confirm-modal');
      modal.hidden = true;
      if (App.confirmResolve) {
        const fn = App.confirmResolve;
        App.confirmResolve = null;
        fn(result);
      }
    },

    showView(viewId) {
      document.querySelectorAll('.view').forEach((v) => {
        v.hidden = v.id !== viewId;
      });
    },

    navigate(hash) {
      if (window.location.hash !== hash) {
        window.location.hash = hash;
      } else {
        App.handleRoute();
      }
    },

    async handleRoute() {
      const hash = window.location.hash || '#/dashboard';

      // Close open popups/overlays on route change
      const docPopup = document.getElementById('doc-popup');
      if (docPopup) docPopup.hidden = true;
      if (window.ViewerManager && !document.getElementById('viewer-overlay').hidden) {
        window.ViewerManager.close();
      }

      if (!App.user) {
        App.showView('auth-view');
        if (window.AuthController) {
          window.AuthController.setTab(hash === '#/register' ? 'register' : 'login');
        }
        return;
      }

      if (hash === '#/login' || hash === '#/register') {
        App.navigate('#/dashboard');
        return;
      }

      const projectMatch = hash.match(/^#\/project\/([^/]+)$/);
      if (projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        App.showView('project-view');
        if (window.ProjectController) {
          await window.ProjectController.load(projectId);
        }
        return;
      }

      // Default: Dashboard
      App.showView('dashboard-view');
      if (window.DashboardController) {
        await window.DashboardController.load();
      }
    },

    updateUserAvatars() {
      if (!App.user) return;
      const initials = App.getInitials(App.user.name || App.user.email);
      const dashAvatar = document.getElementById('dash-avatar');
      const dashName = document.getElementById('dash-user-name');
      const projAvatar = document.getElementById('proj-avatar');
      if (dashAvatar) dashAvatar.textContent = initials;
      if (dashName) dashName.textContent = App.user.name || App.user.email;
      if (projAvatar) projAvatar.textContent = initials;
    },

    bindGlobalModals() {
      document.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('[data-close]');
        if (closeBtn) {
          const overlay = closeBtn.closest('.modal-overlay');
          if (overlay) {
            if (overlay.id === 'confirm-modal') {
              App.closeConfirm(false);
            } else {
              overlay.hidden = true;
            }
          }
          return;
        }
        if (e.target.classList.contains('modal-overlay')) {
          if (e.target.id === 'confirm-modal') {
            App.closeConfirm(false);
          } else {
            e.target.hidden = true;
          }
        }
      });

      const yesBtn = document.getElementById('confirm-yes');
      if (yesBtn) {
        yesBtn.addEventListener('click', () => App.closeConfirm(true));
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const viewer = document.getElementById('viewer-overlay');
          if (viewer && !viewer.hidden && window.ViewerManager) {
            window.ViewerManager.close();
            return;
          }
          const openModals = document.querySelectorAll('.modal-overlay:not([hidden])');
          if (openModals.length > 0) {
            const top = openModals[openModals.length - 1];
            if (top.id === 'confirm-modal') App.closeConfirm(false);
            else top.hidden = true;
            return;
          }
          const popup = document.getElementById('doc-popup');
          if (popup && !popup.hidden) {
            popup.hidden = true;
          }
        }
      });
    },

    initTheme() {
      const saved = localStorage.getItem('arcsite_theme') || 'studio';
      App.setTheme(saved, false);
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-set-theme]');
        if (btn) {
          App.setTheme(btn.dataset.setTheme, true);
        }
      });
    },

    setTheme(themeName, persist = true) {
      const valid = ['studio', 'blueprint', 'cad-dark'];
      const theme = valid.includes(themeName) ? themeName : 'studio';
      document.body.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      document.querySelectorAll('[data-set-theme]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.setTheme === theme);
      });
      if (persist) {
        try { localStorage.setItem('arcsite_theme', theme); } catch {}
      }
    },

    async init() {
      App.initTheme();
      App.bindGlobalModals();
      window.addEventListener('hashchange', () => App.handleRoute());

      if (window.AuthController) window.AuthController.init();
      if (window.DashboardController) window.DashboardController.init();
      if (window.ProjectController) window.ProjectController.init();
      if (window.MapController) window.MapController.init();
      if (window.ViewerManager) window.ViewerManager.init();

      try {
        const res = await App.api('/api/auth/me', { skipAuthRedirect: true });
        if (res && res.user) {
          App.user = res.user;
          App.updateUserAvatars();
        }
      } catch {
        App.user = null;
      }

      await App.handleRoute();
    },
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})();
