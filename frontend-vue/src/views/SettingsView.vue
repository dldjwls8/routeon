<template>
  <div class="settings-page">
    <header class="topbar">
      <a href="/dashboard" class="back-btn">← 대시보드</a>
      <span class="topbar-title">⚙ 설정</span>
    </header>

    <div class="main">
      <div class="msg" id="page-message"></div>

      <div class="card" role="region" aria-labelledby="profile-head">
        <div class="card-head">
          <div>
            <h2 id="profile-head">프로필 이미지</h2>
            <p>채팅에서 상대방에게 표시되는 이미지를 관리합니다.</p>
          </div>
        </div>
        <div class="profile-editor">
          <div class="profile-preview" id="profile-preview">관</div>
          <div>
            <div class="profile-actions">
              <label class="btn btn-primary" for="profile-file">이미지 업로드</label>
              <input id="profile-file" type="file" accept=".jpg,.jpeg,.png,.webp" hidden>
              <button class="btn btn-ghost" id="delete-profile-btn" type="button">이미지 삭제</button>
            </div>
            <div class="msg" id="profile-message"></div>
          </div>
        </div>
      </div>

      <!-- 계정 정보 -->
      <div class="card" role="region" aria-labelledby="account-head">
        <div class="card-head">
          <div>
            <h2 id="account-head">계정 정보</h2>
            <p>현재 관리자 계정의 전화번호와 비밀번호를 변경합니다.</p>
          </div>
        </div>
        <div class="info-row">
          <span class="info-label">아이디</span>
          <span class="info-value" id="account-username">—</span>
        </div>
        <div class="info-row" style="margin-bottom:22px">
          <span class="info-label">현재 전화번호</span>
          <span class="info-value" id="account-phone">—</span>
        </div>
        <form id="phone-form">
          <div class="field-group">
            <label class="field-label" for="phone-input">전화번호 변경</label>
            <div class="field-row">
              <input id="phone-input" type="tel" autocomplete="tel" placeholder="변경할 전화번호">
              <button class="btn btn-primary" id="update-phone-btn" type="submit" disabled>저장</button>
            </div>
          </div>
        </form>
        <form id="password-form">
          <div class="field-group">
            <label class="field-label">비밀번호 변경</label>
            <div class="field-row" style="flex-wrap:wrap">
              <input id="current-password-input" type="password" autocomplete="current-password" placeholder="현재 비밀번호" style="min-width:140px">
              <input id="new-password-input" type="password" autocomplete="new-password" placeholder="새 비밀번호 (4자 이상)" style="min-width:160px">
              <button class="btn btn-primary" id="update-password-btn" type="submit" disabled>저장</button>
            </div>
          </div>
        </form>
        <div class="msg" id="account-message"></div>
      </div>

      <!-- 화면 설정 -->
      <div class="card" role="region" aria-labelledby="display-head">
        <div class="card-head">
          <div>
            <h2 id="display-head">화면 설정</h2>
            <p>모든 페이지의 테마를 변경합니다. 즉시 적용됩니다.</p>
          </div>
        </div>
        <div class="theme-seg">
          <label class="theme-seg-item">
            <input type="radio" name="theme" value="auto">
            <span class="theme-seg-label"><span class="theme-seg-icon">🖥</span>자동</span>
          </label>
          <label class="theme-seg-item">
            <input type="radio" name="theme" value="dark">
            <span class="theme-seg-label"><span class="theme-seg-icon">🌙</span>다크</span>
          </label>
          <label class="theme-seg-item">
            <input type="radio" name="theme" value="light">
            <span class="theme-seg-label"><span class="theme-seg-icon">☀️</span>라이트</span>
          </label>
        </div>
      </div>

      <div class="card danger-card" role="region" aria-labelledby="withdraw-head">
        <div class="card-head">
          <div>
            <h2 id="withdraw-head">계정 탈퇴</h2>
            <p>최상위 기업관리자는 권한 이전 후 탈퇴할 수 있습니다.</p>
          </div>
        </div>
        <div class="field-row">
          <input id="withdraw-password" type="password" autocomplete="current-password" placeholder="현재 비밀번호">
          <button class="btn btn-danger" id="withdraw-btn" type="button">계정 탈퇴</button>
        </div>
        <div class="msg" id="withdraw-message"></div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  const API = (() => {
    const h = location.hostname;
    if (!h || h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8000';
    if (location.port && location.port !== '80' && location.port !== '443') return `${location.protocol}//${h}:8000`;
    return `${location.protocol}//${location.host}/api`;
  })();

  function getToken() { return localStorage.getItem('token'); }
  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
  }
  function redirectToLogin() { location.href = '/login'; }

  if (!getToken()) redirectToLogin();

  function requireAdmin(user) {
    if (!user || user.role !== 'admin') {
      showMsg('page-message', '관리자 계정만 설정 페이지에 접근할 수 있습니다.', 'error');
      setTimeout(() => {
        location.href = user && user.role === 'driver' ? '/driver.html' : '/login';
      }, 800);
      return false;
    }
    return true;
  }

  async function initPage() {
    try {
      const user = await loadCurrentUser();
      if (!requireAdmin(user)) return;
      renderCurrentUser(user);
    } catch (e) {
      showMsg('page-message', e.message || '설정 정보를 불러오지 못했습니다.', 'error');
    }
  }

  async function loadCurrentUser() {
    const r = await fetch(`${API}/auth/me`, { headers: authHeaders() });
    if (r.status === 401) { redirectToLogin(); throw new Error('로그인이 필요합니다.'); }
    if (!r.ok) throw new Error(await parseErrorMessage(r, '계정 정보를 불러오지 못했습니다.'));
    return r.json();
  }

  function renderCurrentUser(user) {
    document.getElementById('account-username').textContent = user.username || '—';
    document.getElementById('account-phone').textContent = user.phone || '—';
    document.getElementById('phone-input').value = user.phone || '';
    const preview = document.getElementById('profile-preview');
    preview.innerHTML = user.profile_image
      ? `<img src="${API}${user.profile_image}" alt="프로필 이미지">`
      : (user.name || user.username || '관').slice(0, 1);
    document.getElementById('delete-profile-btn').disabled = !user.profile_image;
  }

  async function uploadProfile(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    showMsg('profile-message', '프로필 이미지를 업로드하는 중입니다.', 'info');
    const r = await fetch(`${API}/auth/me/profile-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form,
    });
    if (!r.ok) { showMsg('profile-message', await parseErrorMessage(r, '업로드에 실패했습니다.'), 'error'); return; }
    renderCurrentUser(await loadCurrentUser());
    showMsg('profile-message', '프로필 이미지가 변경됐습니다.', 'success');
  }

  async function deleteProfile() {
    const r = await fetch(`${API}/auth/me/profile-image`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok && r.status !== 204) { showMsg('profile-message', await parseErrorMessage(r, '삭제에 실패했습니다.'), 'error'); return; }
    renderCurrentUser(await loadCurrentUser());
    showMsg('profile-message', '프로필 이미지가 삭제됐습니다.', 'success');
  }

  async function withdrawAccount() {
    const currentPassword = document.getElementById('withdraw-password').value;
    if (!currentPassword) { showMsg('withdraw-message', '현재 비밀번호를 입력해주세요.', 'error'); return; }
    if (!confirm('계정을 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    const r = await fetch(`${API}/auth/me`, {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ current_password: currentPassword }),
    });
    if (!r.ok && r.status !== 204) { showMsg('withdraw-message', await parseErrorMessage(r, '계정 탈퇴에 실패했습니다.'), 'error'); return; }
    localStorage.removeItem('token');
    location.href = '/login';
  }

  function enableAccountForms() {
    document.getElementById('update-phone-btn').disabled = false;
    document.getElementById('update-password-btn').disabled = false;
  }

  async function updatePhone(e) {
    e.preventDefault();
    const phone = document.getElementById('phone-input').value.trim();
    if (!phone) { showMsg('account-message', '변경할 전화번호를 입력해주세요.', 'error'); return; }
    const btn = document.getElementById('update-phone-btn');
    setLoading(btn, true);
    showMsg('account-message', '전화번호를 저장하는 중입니다.', 'info');
    try {
      const r = await fetch(`${API}/auth/me`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ phone }),
      });
      if (r.status === 401) { redirectToLogin(); return; }
      if (!r.ok) throw new Error(await parseErrorMessage(r, '전화번호 변경에 실패했습니다.'));
      renderCurrentUser(await r.json());
      showMsg('account-message', '전화번호가 변경됐습니다.', 'success');
    } catch (e) {
      showMsg('account-message', e.message || '전화번호 변경에 실패했습니다.', 'error');
    } finally {
      setLoading(btn, false);
    }
  }

  async function updatePassword(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('current-password-input').value.trim();
    const newPassword     = document.getElementById('new-password-input').value.trim();
    if (!currentPassword) { showMsg('account-message', '현재 비밀번호를 입력해주세요.', 'error'); return; }
    if (!newPassword)      { showMsg('account-message', '새 비밀번호를 입력해주세요.', 'error'); return; }
    if (newPassword.length < 4) { showMsg('account-message', '새 비밀번호는 4자 이상이어야 합니다.', 'error'); return; }
    const btn = document.getElementById('update-password-btn');
    setLoading(btn, true);
    showMsg('account-message', '비밀번호를 저장하는 중입니다.', 'info');
    try {
      const r = await fetch(`${API}/auth/me`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (r.status === 401) { redirectToLogin(); return; }
      if (!r.ok) throw new Error(await parseErrorMessage(r, '비밀번호 변경에 실패했습니다.'));
      document.getElementById('current-password-input').value = '';
      document.getElementById('new-password-input').value = '';
      showMsg('account-message', '비밀번호가 변경됐습니다. 다음 로그인 시 새 비밀번호가 적용됩니다.', 'success');
    } catch (e) {
      showMsg('account-message', e.message || '비밀번호 변경에 실패했습니다.', 'error');
    } finally {
      setLoading(btn, false);
    }
  }

  function setLoading(btn, loading) {
    if (!btn) return;
    if (loading) { btn.dataset.orig = btn.textContent; btn.disabled = true; btn.textContent = '처리 중…'; }
    else { btn.disabled = false; if (btn.dataset.orig) btn.textContent = btn.dataset.orig; }
  }

  function showMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = `msg ${type || 'info'} ${text ? 'show' : ''}`;
  }

  async function parseErrorMessage(r, fallback) {
    try {
      const d = await r.json();
      if (typeof d.detail === 'string') return d.detail;
      if (d.detail) return JSON.stringify(d.detail);
      if (d.message) return d.message;
    } catch (_) {}
    return fallback;
  }

  /* ── 테마 선택 ── */
  function applyTheme(value) {
    if (value === 'auto') {
      localStorage.removeItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      localStorage.setItem('theme', value);
      document.documentElement.setAttribute('data-theme', value);
    }
  }
  function initThemeSeg() {
    const current = localStorage.getItem('theme') || 'auto';
    document.querySelectorAll('input[name="theme"]').forEach(r => {
      r.checked = r.value === current;
      r.addEventListener('change', () => { if (r.checked) applyTheme(r.value); });
    });
  }
  /* OS 테마 변경 시 '자동' 상태이면 즉시 반영 */
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
  initThemeSeg();

  document.getElementById('phone-form').addEventListener('submit', updatePhone);
  document.getElementById('password-form').addEventListener('submit', updatePassword);
  document.getElementById('profile-file').addEventListener('change', event => uploadProfile(event.target.files[0]));
  document.getElementById('delete-profile-btn').addEventListener('click', deleteProfile);
  document.getElementById('withdraw-btn').addEventListener('click', withdrawAccount);
  enableAccountForms();
  initPage();
});
</script>

<style>
.settings-page {
  font-family: 'Noto Sans KR', system-ui, sans-serif;
  background: var(--dark-bg);
  color: var(--t-text);
  min-height: 100vh;
}

:root {
  --lime: #c6f135;
  --lime-dim: #a8d42e;
  --lime-glow: rgba(198,241,53,.25);
  --dark-bg:      #0c0e12;
  --dark-surface: #151820;
  --dark-card:    #1c2029;
  --dark-border:  rgba(255,255,255,.08);
  --radius-lg: 20px;
  --radius-md: 14px;
  --radius-sm: 10px;
  --t-text:        #e8eaef;
  --t-text-strong: #f3f4f6;
  --t-text-muted:  #8b93a7;
  --t-text-dim:    #c5cad6;
  --t-deep:        #12151c;
  --t-nav-hover:   rgba(255,255,255,.06);
  --t-border-strong: rgba(255,255,255,.12);
}
html[data-theme="light"] {
  color-scheme: light;
  --dark-bg:      #f5f7fa;
  --dark-surface: #ffffff;
  --dark-card:    #ffffff;
  --dark-border:  #e2e8f0;
  --t-text:        #1e2230;
  --t-text-strong: #0f1117;
  --t-text-muted:  #5c6478;
  --t-text-dim:    #374151;
  --t-deep:        #f3f4f6;
  --t-nav-hover:   rgba(0,0,0,.04);
  --t-border-strong: rgba(0,0,0,.1);
}
html[data-theme="dark"] { color-scheme: dark; }

* { box-sizing: border-box; margin: 0; padding: 0; }

/* ── 탑바 ── */
.topbar {
  display: flex; align-items: center; gap: 14px;
  background: var(--dark-bg); border-bottom: 1px solid var(--dark-border);
  padding: 0 24px; height: 56px; position: sticky; top: 0; z-index: 100;
}
.back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--dark-border); background: var(--dark-surface);
  color: var(--t-text-dim); font-size: 13px; font-family: inherit;
  cursor: pointer; text-decoration: none; transition: background .15s, color .15s;
}
.back-btn:hover { background: var(--t-nav-hover); color: var(--t-text); }
.topbar-title {
  font-size: 15px; font-weight: 700; color: var(--t-text-strong);
}

/* ── 레이아웃 ── */
.main { max-width: 660px; margin: 0 auto; padding: 28px 20px 64px; }

/* ── 카드 ── */
.card {
  background: var(--dark-card); border: 1px solid var(--dark-border);
  border-radius: var(--radius-md); padding: 24px; margin-bottom: 16px;
}
.card-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  border-bottom: 1px solid var(--dark-border);
  padding-bottom: 16px; margin-bottom: 20px;
}
.card-head h2 { font-size: 15px; font-weight: 700; color: var(--t-text-strong); }
.card-head p { font-size: 12px; color: var(--t-text-muted); margin-top: 4px; line-height: 1.5; }
.profile-editor { display: flex; align-items: center; gap: 18px; }
.profile-preview {
  width: 76px; height: 76px; border-radius: 50%; overflow: hidden; flex: 0 0 auto;
  display: grid; place-items: center; background: var(--dark-surface);
  border: 1px solid var(--dark-border); color: var(--t-text-muted); font-size: 24px; font-weight: 700;
}
.profile-preview img { width: 100%; height: 100%; object-fit: cover; }
.profile-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.danger-card { border-color: rgba(239,68,68,.25); }

/* ── 정보 행 ── */
.info-row { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
.info-label {
  font-size: 12px; color: var(--t-text-muted); font-weight: 600;
  width: 100px; flex-shrink: 0; letter-spacing: .01em;
}
.info-value { font-size: 14px; color: var(--t-text); }

/* ── 조직코드 ── */
.org-code {
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 21px; font-weight: 800; letter-spacing: .06em;
  color: var(--lime);
  background: rgba(198,241,53,.08); border: 1px solid rgba(198,241,53,.2);
  border-radius: 8px; padding: 8px 14px; user-select: all;
}
.org-code-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── 폼 ── */
.field-group { margin-bottom: 16px; }
.field-group:last-of-type { margin-bottom: 0; }
.field-label {
  display: block; font-size: 12px; color: var(--t-text-muted);
  font-weight: 600; margin-bottom: 8px; letter-spacing: .01em;
}
.field-row { display: flex; gap: 8px; align-items: flex-start; }
input[type=text],
input[type=password],
input[type=tel] {
  flex: 1; padding: 10px 14px;
  background: var(--dark-surface); border: 1px solid var(--dark-border);
  border-radius: 8px; color: var(--t-text); font-size: 14px;
  font-family: inherit; min-width: 0; transition: border-color .15s, box-shadow .15s;
}
input::placeholder { color: var(--t-text-muted); opacity: 1; }
input:focus { outline: none; border-color: var(--lime); box-shadow: 0 0 0 3px var(--lime-glow); }

/* ── 버튼 ── */
.btn {
  padding: 10px 16px; border: none; border-radius: 8px;
  cursor: pointer; font-weight: 600; font-size: 13px; font-family: inherit;
  white-space: nowrap; transition: opacity .15s, background .15s;
}
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn-primary { background: var(--lime); color: #0c0e12; }
.btn-primary:hover:not(:disabled) { background: var(--lime-dim); }
.btn-ghost {
  background: var(--dark-surface); color: var(--t-text-dim);
  border: 1px solid var(--dark-border);
}
.btn-ghost:hover:not(:disabled) { background: var(--t-nav-hover); color: var(--t-text); }
.btn-danger {
  background: rgba(239,68,68,.12); color: #f87171;
  border: 1px solid rgba(239,68,68,.22);
}
.btn-danger:hover:not(:disabled) { background: rgba(239,68,68,.2); }

/* ── 토글 스위치 ── */
.toggle-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px; border: 1px solid var(--dark-border);
  border-radius: var(--radius-sm); background: var(--dark-surface);
}
.toggle-label { font-size: 14px; font-weight: 600; color: var(--t-text); }
.toggle-desc { font-size: 12px; color: var(--t-text-muted); margin-top: 4px; line-height: 1.55; }
.switch { position: relative; display: inline-block; width: 48px; height: 26px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--dark-border); transition: .2s; border-radius: 26px;
}
.slider::before {
  position: absolute; content: "";
  height: 20px; width: 20px; left: 3px; bottom: 3px;
  background: var(--t-text-muted); transition: .2s; border-radius: 50%;
}
.switch input:checked + .slider { background: var(--lime); }
.switch input:checked + .slider::before { transform: translateX(22px); background: #0c0e12; }

/* ── 메시지 ── */
.msg {
  display: none; margin-top: 14px; font-size: 12px; line-height: 1.5;
  padding: 10px 14px; border-radius: 8px;
}
.msg.show { display: block; }
.msg.info    { background: rgba(96,165,250,.08); color: #93c5fd; border: 1px solid rgba(96,165,250,.18); }
.msg.success { background: rgba(198,241,53,.07); color: var(--lime-dim); border: 1px solid rgba(198,241,53,.16); }
.msg.error   { background: rgba(239,68,68,.08); color: #f87171;  border: 1px solid rgba(239,68,68,.18); }

/* ── 테마 선택 ── */
.theme-seg { display: flex; gap: 8px; }
.theme-seg-item { flex: 1; position: relative; }
.theme-seg-item input { position: absolute; opacity: 0; width: 0; height: 0; }
.theme-seg-label {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--dark-border); background: var(--dark-surface);
  cursor: pointer; transition: border-color .15s, background .15s;
  font-size: 13px; color: var(--t-text-dim); font-weight: 500;
}
.theme-seg-label:hover { border-color: var(--t-border-strong); color: var(--t-text); }
.theme-seg-icon { font-size: 20px; }
.theme-seg-item input:checked + .theme-seg-label {
  border-color: var(--lime); background: rgba(198,241,53,.08);
  color: var(--t-text-strong);
}

/* ── 반응형 ── */
@media (max-width: 600px) {
  .topbar { padding: 0 16px; }
  .main   { padding: 20px 14px 52px; }
  .card   { padding: 18px 16px; }
  .field-row { flex-wrap: wrap; }
  .btn { width: 100%; }
  .org-code-row { flex-direction: column; align-items: flex-start; }
}
</style>
