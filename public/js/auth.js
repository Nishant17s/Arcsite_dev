/* ==========================================================================
   ArcSite Navigator — Authentication Controller
   ========================================================================== */

(function () {
  'use strict';

  const AuthController = {
    init() {
      const tabs = document.querySelectorAll('.auth-tab');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          AuthController.setTab(tab.dataset.tab);
        });
      });

      const loginForm = document.getElementById('login-form');
      if (loginForm) {
        loginForm.addEventListener('submit', (e) => AuthController.handleLogin(e));
      }

      const registerForm = document.getElementById('register-form');
      if (registerForm) {
        registerForm.addEventListener('submit', (e) => AuthController.handleRegister(e));
      }
    },

    setTab(tabName) {
      const target = tabName === 'register' ? 'register' : 'login';
      document.querySelectorAll('.auth-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === target);
      });
      const loginForm = document.getElementById('login-form');
      const registerForm = document.getElementById('register-form');
      if (loginForm) loginForm.classList.toggle('active', target === 'login');
      if (registerForm) registerForm.classList.toggle('active', target === 'register');

      const loginErr = document.getElementById('login-error');
      const regErr = document.getElementById('register-error');
      if (loginErr) loginErr.textContent = '';
      if (regErr) regErr.textContent = '';
    },

    setLoading(form, loading) {
      const btn = form.querySelector('button[type="submit"]');
      if (!btn) return;
      const text = btn.querySelector('.btn-text');
      const loader = btn.querySelector('.btn-loader');
      btn.disabled = loading;
      if (text) text.style.opacity = loading ? '0.6' : '1';
      if (loader) loader.hidden = !loading;
    },

    async handleLogin(e) {
      e.preventDefault();
      const form = e.target;
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';

      if (!email || !password) {
        errEl.textContent = 'Please enter both email and password.';
        return;
      }

      AuthController.setLoading(form, true);
      try {
        const res = await App.api('/api/auth/login', {
          method: 'POST',
          body: { email, password },
          skipAuthRedirect: true,
        });
        App.user = res.user;
        App.updateUserAvatars();
        form.reset();
        App.toast(`Welcome back, ${App.user.name || App.user.email}`, 'success');
        App.navigate('#/dashboard');
      } catch (err) {
        errEl.textContent = err.message || 'Invalid email or password.';
      } finally {
        AuthController.setLoading(form, false);
      }
    },

    async handleRegister(e) {
      e.preventDefault();
      const form = e.target;
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const errEl = document.getElementById('register-error');
      errEl.textContent = '';

      if (!name || !email || password.length < 6) {
        errEl.textContent = 'Name, valid email, and password (min 6 chars) are required.';
        return;
      }

      AuthController.setLoading(form, true);
      try {
        const res = await App.api('/api/auth/register', {
          method: 'POST',
          body: { name, email, password },
          skipAuthRedirect: true,
        });
        App.user = res.user;
        App.updateUserAvatars();
        form.reset();
        App.toast('Account created successfully!', 'success');
        App.navigate('#/dashboard');
      } catch (err) {
        errEl.textContent = err.message || 'Could not create account.';
      } finally {
        AuthController.setLoading(form, false);
      }
    },
  };

  window.AuthController = AuthController;
})();
