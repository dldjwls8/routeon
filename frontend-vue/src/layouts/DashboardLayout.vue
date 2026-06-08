<script setup>
import { onMounted, onUnmounted, watch, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useChatSocket } from '@/composables/useChatSocket.js'
import { apiClient } from '@/api/client.js'

const router = useRouter()
const chat = useChatSocket()
const WS_BASE = apiClient.wsBase

const locationAlerts = ref([])
let locationWs = null

function getToken() {
  return localStorage.getItem('token') || ''
}

function connectLocationSocket() {
  const token = getToken()
  if (!token || locationWs) return
  const ws = new WebSocket(`${WS_BASE}/ws/location?token=${token}`)
  locationWs = ws
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'trip.cancel_requested') {
        locationAlerts.value.push({
          type: 'trip.cancel_requested',
          trip_id: msg.trip_id,
          driver_id: msg.driver_id,
          reason: msg.reason,
          at: new Date().toISOString(),
        })
      }
    } catch {}
  }
  ws.onclose = () => { locationWs = null; setTimeout(connectLocationSocket, 5000) }
  ws.onerror = () => ws.close()
}

function disconnectLocationSocket() {
  if (locationWs) {
    locationWs.close()
    locationWs = null
  }
}

function updateMessageBadge(total) {
  const mb = document.getElementById('messageBadge')
  if (mb) mb.style.display = total > 0 ? '' : 'none'
}

function updateNotifUI() {
  const nb = document.getElementById('notifBadge')
  const drop = document.getElementById('notifDropdown')
  const alerts = locationAlerts.value
  if (nb) nb.style.display = alerts.length > 0 ? '' : 'none'
  if (!drop) return
  if (!alerts.length) {
    drop.innerHTML = '<div class="topbar-dropdown-header">알림</div><div class="topbar-dropdown-empty">새 알림이 없습니다</div>'
    return
  }
  const items = alerts.slice().reverse().map((a, idx) => {
    const reason = escapeHtml(a.reason)
    return `<button type="button" class="topbar-dropdown-item" onclick="location.href='/dispatch-manage'">🚨 기사 취소 요청 <span class="badge badge-danger" style="margin-left:auto">${reason}</span></button>`
  }).join('')
  drop.innerHTML = `<div class="topbar-dropdown-header">새 알림</div>${items}`
}

/* ── 대시보드 초기화 ── */
onMounted(async () => {
  document.body.classList.add('theme-dashboard')
  if (typeof window.RouteOnInit === 'function' && !window._routeOnDashboardInitDone) {
    window._routeOnDashboardInitDone = true
    await window.RouteOnInit()
  }

  chat.connect()
  chat.loadPartners()
  chat.loadConversations()
  connectLocationSocket()

  nextTick(() => {
    const mb = document.getElementById('messageBtn')
    if (mb) mb.onclick = () => { router.push('/chat') }
  })
})

onUnmounted(() => {
  document.body.classList.remove('theme-dashboard')
  chat.disconnect()
  disconnectLocationSocket()
})

watch(() => chat.totalUnread.value, (total) => {
  updateMessageBadge(total)
}, { immediate: true })

watch(locationAlerts, () => {
  updateNotifUI()
}, { deep: true, immediate: true })

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
