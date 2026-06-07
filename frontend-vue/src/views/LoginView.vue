<template>
  <div class="login-page">
    <div class="auth-card">
      <img src="/routeon_logo.png" alt="RouteOn Logo" class="logo-img">
      <h2>로그인</h2>
      <form id="loginForm">
        <input type="text" id="username" placeholder="아이디" required>
        <input type="password" id="password" placeholder="비밀번호" required>
        <button type="submit" class="btn">로그인</button>
      </form>
      <div id="loginMessage" class="login-message" role="alert" aria-live="polite"></div>
      <a href="/register" class="link">관리자 계정이 없으신가요? 가입하기</a>
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

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('theme')) document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
  });

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = document.getElementById('loginMessage');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    message.textContent = '';
    button.disabled = true;
    button.textContent = '로그인 중...';

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : {};
      if (res.ok && data.access_token) {
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user_id', data.user_id);
        localStorage.setItem('username', data.username);
        localStorage.setItem('role', data.role);
        if (data.role === 'driver') {
          window.location.href = '/driver.html';
        } else if (data.role === 'superadmin') {
          localStorage.setItem('sa_token', data.access_token);
          window.location.href = '/superadmin.html';
        } else {
          window.location.href = '/dashboard';
        }
      } else {
        message.textContent = data.detail || (
          res.status >= 500
            ? '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'
            : '로그인에 실패했습니다.'
        );
      }
    } catch (error) {
      message.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.';
    } finally {
      button.disabled = false;
      button.textContent = '로그인';
    }
  });
});
</script>

<style>
.login-page {
  margin: 0;
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: var(--t-bg);
  font-family: 'Malgun Gothic', sans-serif;
}

:root {
  --lime: #c6f135;
  --t-bg: #0c0e12;
  --t-card: #1c2029;
  --t-border: rgba(255,255,255,.08);
  --t-text: #e8eaef;
  --t-text-strong: #f3f4f6;
  --t-text-muted: #8b93a7;
  --t-input-bg: #151820;
}
html[data-theme="light"] {
  color-scheme: light;
  --t-bg: #f5f7fa;
  --t-card: #ffffff;
  --t-border: #e2e8f0;
  --t-text: #1e2230;
  --t-text-strong: #0f1117;
  --t-text-muted: #5c6478;
  --t-input-bg: #f8fafc;
}

.auth-card { background: var(--t-card); padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.2); width: 350px; text-align: center; border: 1px solid var(--t-border); }
.logo-img { height: 50px; margin-bottom: 20px; }
h2 { margin: 0 0 20px 0; color: var(--t-text-strong); font-size: 20px; }
input { width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid var(--t-border); border-radius: 6px; font-size: 14px; background: var(--t-input-bg); color: var(--t-text); outline: none; }
input:focus { border-color: var(--lime); }
input::placeholder { color: var(--t-text-muted); }
.btn { width: 100%; padding: 12px; background: var(--lime); color: #111; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 4px; }
.btn:hover { background: #a8d42e; }
.btn:disabled { cursor: wait; opacity: .65; }
.login-message { min-height: 18px; margin-top: 12px; color: #ef4444; font-size: 13px; line-height: 1.4; }
.link { display: block; margin-top: 16px; font-size: 13px; color: var(--t-text-muted); text-decoration: none; }
.link:hover { color: var(--t-text); text-decoration: underline; }
</style>
