<script setup>
import { onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useChatSocket } from '@/composables/useChatSocket.js'

const router = useRouter()
const chat = useChatSocket()

/* ── 대시보드 초기화 ── */
onMounted(async () => {
  document.body.classList.add('theme-dashboard')
  if (typeof window.RouteOnInit === 'function' && !window._routeOnDashboardInitDone) {
    window._routeOnDashboardInitDone = true
    await window.RouteOnInit()
  }

  /* ── Vue unread → legacy DOM badge 동기화 ── */
  chat.connect()
  chat.loadPartners()
  chat.loadConversations()

  /* messageBtn 클릭을 Vue router 로 연결 */
  nextTick(() => {
    const mb = document.getElementById('messageBtn')
    if (mb) mb.onclick = () => { router.push('/chat') }
  })
})

onUnmounted(() => {
  document.body.classList.remove('theme-dashboard')
  chat.disconnect()
})

/* totalUnread 변화를 감시하여 legacy DOM badge 직접 동기화 */
watch(() => chat.totalUnread.value, (total) => {
  const mb = document.getElementById('messageBadge')
  const nb = document.getElementById('notifBadge')
  if (mb) mb.style.display = total > 0 ? '' : 'none'
  if (nb) nb.style.display = total > 0 ? '' : 'none'

  const drop = document.getElementById('notifDropdown')
  if (!drop) return

  if (!total) {
    drop.innerHTML = '<div class="topbar-dropdown-header">알림</div><div class="topbar-dropdown-empty">새 알림이 없습니다</div>'
    return
  }

  const entries = Object.entries(chat.state.convByPartner || {})
    .filter(([, c]) => (c?.unread_count || 0) > 0)

  const items = entries.map(([pid, c]) => {
    const p = chat.state.partners?.find(x => x.id === pid)
    const name = p?.name || p?.username || '사용자'
    const n = c.unread_count
    return `<button type="button" class="topbar-dropdown-item" onclick="location.href='/chat?partner_id=${pid}'">💬 ${escapeHtml(name)}<span class="badge badge-info" style="margin-left:auto">${n > 99 ? '99+' : n}</span></button>`
  }).join('')

  drop.innerHTML = `<div class="topbar-dropdown-header">새 메시지</div>${items}`
}, { immediate: true })

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar" id="topBar">
      <button type="button" class="brand" id="brandHome" aria-label="RouteOn 홈">
        <img class="brand-mark" src="/routeon_logo.png" alt="" aria-hidden="true">
        <span class="brand-text">RouteOn<small>물류 관제</small></span>
      </button>
      <nav class="top-nav" id="navMain" aria-label="주 메뉴"></nav>
      <div class="topbar-meta">
        <span class="topbar-date">오늘 <strong id="headerDate"></strong></span>
        <button type="button" class="topbar-icon-btn message-btn-wrap" id="messageBtn" title="메시지" aria-label="메시지">💬<span class="notif-dot" id="messageBadge" style="display:none"></span></button>
        <div class="topbar-btn-wrap">
          <button type="button" class="topbar-icon-btn notif-btn-wrap" id="notifBtn" title="알림" aria-label="알림">🔔<span class="notif-dot" id="notifBadge" style="display:none"></span></button>
          <div class="topbar-dropdown" id="notifDropdown" style="min-width:220px">
            <div class="topbar-dropdown-header">알림</div>
            <div class="topbar-dropdown-empty">새 알림이 없습니다</div>
          </div>
        </div>
        <div class="topbar-btn-wrap">
          <button type="button" class="topbar-user-btn" id="userMenuBtn" aria-label="계정 메뉴" aria-haspopup="true">👤 <strong id="topbarUserName">관리자</strong> <small id="topbarUserRole">admin</small></button>
          <div class="topbar-dropdown" id="userDropdown">
            <div class="topbar-dropdown-header">계정</div>
            <button type="button" class="topbar-dropdown-item" id="ddSettings">⚙ 계정 설정</button>
            <hr class="topbar-dropdown-divider">
            <button type="button" class="topbar-dropdown-item topbar-dropdown-item--danger" id="ddLogout">↩ 로그아웃</button>
          </div>
        </div>
      </div>
    </header>
    <main class="content" id="mainContent"><slot /></main>
    <footer class="footer legal-footer" aria-label="서비스 안내">
      <div class="legal-footer-main">
        <strong>RouteOn 관제 시스템</strong>
        <span>© 2026 RouteOn Team. 졸업작품 프로젝트.</span>
        <span>운영 데이터는 시연·검증 목적에 맞춰 관리합니다.</span>
      </div>
      <div class="legal-footer-actions">
        <a class="footer-link-btn" href="/terms.html">이용약관</a>
        <a class="footer-link-btn" href="/privacy.html">개인정보 처리방침</a>
        <a class="footer-link-btn" href="/copyright.html">저작권 안내</a>
        <a class="footer-link-btn" href="/contact.html">문의</a>
      </div>
    </footer>
  </div>

  <div class="overlay" id="modalOverlay" aria-hidden="true">
    <div class="modal" id="modalBox" role="dialog"></div>
  </div>
  <div class="toast" id="toast">저장되었습니다</div>

  <div id="map-container" style="display:none;position:relative;width:100%;height:100%;">
    <div id="map" style="width:100%;height:100%;"></div>
  </div>
</template>
