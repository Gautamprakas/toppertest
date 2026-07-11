/* ============================================================
   TopperTest.com — Global JS Utilities
   ============================================================ */

const API_BASE = '/api';

/* ── Storage Helpers ─────────────────────────────────────── */
const Auth = {
  getToken:  () => localStorage.getItem('tt_token'),
  getUser:   () => JSON.parse(localStorage.getItem('tt_user') || 'null'),
  setToken:  (t) => localStorage.setItem('tt_token', t),
  setUser:   (u) => localStorage.setItem('tt_user', JSON.stringify(u)),
  isLoggedIn:() => !!localStorage.getItem('tt_token'),
  isAdmin:   () => Auth.getUser()?.role === 'admin',
  logout:    () => { localStorage.removeItem('tt_token'); localStorage.removeItem('tt_user'); window.location.href = '/pages/login.html'; },
};

/* ── API Fetch ───────────────────────────────────────────── */
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res  = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Toast Notification ──────────────────────────────────── */
function showToast(msg, type = 'info', duration = 3500) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.style.cssText = 'position:fixed;top:80px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  const colors = { info:'#3b82f6', success:'#10b981', error:'#ef4444', warning:'#f59e0b' };
  t.style.cssText = `background:#fff;border-left:4px solid ${colors[type]||colors.info};padding:12px 18px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:14px;max-width:320px;animation:slideIn .3s;`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

/* ── Guard: redirect if not logged in ───────────────────── */
function requireLogin() {
  if (!Auth.isLoggedIn()) { window.location.href = '/pages/login.html'; return false; }
  return true;
}
function requireAdmin() {
  if (!Auth.isAdmin()) { window.location.href = '/pages/dashboard.html'; return false; }
  return true;
}

/* ── Update Navbar based on auth state ──────────────────── */
function initNavbar() {
  const navRight = document.getElementById('nav-right');
  if (!navRight) return;
  if (Auth.isLoggedIn()) {
    const u = Auth.getUser();
    navRight.innerHTML = `
      <span style="color:rgba(255,255,255,.8);font-size:13px;">${u.name}</span>
      ${u.role === 'admin' ? '<a href="/pages/admin.html" class="btn btn-accent btn-sm">Admin</a>' : ''}
      <a href="/pages/dashboard.html" class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,.4);color:#fff;">Dashboard</a>
      <button onclick="Auth.logout()" class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff;">Logout</button>`;
  } else {
    navRight.innerHTML = `
      <a href="/pages/login.html"    class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,.4);color:#fff;">Login</a>
      <a href="/pages/register.html" class="btn btn-accent btn-sm">Register Free</a>`;
  }
}

/* ── Format Helpers ──────────────────────────────────────── */
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '-'; }
function fmtNum(n)  { return Number(n || 0).toLocaleString('en-IN'); }

/* ── CSS animation ───────────────────────────────────────── */
const styleEl = document.createElement('style');
styleEl.textContent = `@keyframes slideIn { from { transform:translateX(40px); opacity:0; } to { transform:none; opacity:1; } }`;
document.head.appendChild(styleEl);

document.addEventListener('DOMContentLoaded', initNavbar);

/* ── HTML escape ───────────────────────────────────── */
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Branded confirm dialog ──────────────────────────
   Uses SweetAlert2 when the page has loaded its CDN script; falls back to
   the native confirm() on pages that haven't. Always returns a Promise. */
function ttConfirm(title, text = '', confirmText = 'Yes, continue') {
  if (typeof Swal === 'undefined') {
    return Promise.resolve(window.confirm(text ? `${title}\n\n${text}` : title));
  }
  return Swal.fire({
    title,
    text,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#1c1f26',
    cancelButtonColor: '#94a3b8',
    reverseButtons: true,
  }).then(r => r.isConfirmed);
}
