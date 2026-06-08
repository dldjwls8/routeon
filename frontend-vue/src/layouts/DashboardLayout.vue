<script setup>
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useChatSocket } from '@/composables/useChatSocket.js'
import { apiClient } from '@/api/client.js'

const router = useRouter()
const route = useRoute()
const chat = useChatSocket()
const WS_BASE = apiClient.wsBase

/* ── Navigation data ── */
const NAV = [
  { id: 'dashboard', label: '대시보드', pages: [{ id: 'dashboard', label: '요약', path: '/dashboard' }] },
  { id: 'control', label: '운행관제', pages: [{ id: 'control-live', label: '실시간 차량 관제', path: '/control-live' }] },
  { id: 'dispatch', label: '오더관리', pages: [
    { id: 'order-intake', label: '오더접수', path: '/order-intake' },
    { id: 'order-list', label: '오더목록', path: '/order-list' },
    { id: 'dispatch-manage', label: '배차관리', path: '/dispatch-manage' },
  ]},
  { id: 'customers', label: '고객관리', pages: [{ id: 'customer-list', label: '고객 관리', path: '/customer-list' }] },
  { id: 'schedule', label: '일정·통계', pages: [
    { id: 'schedule-calendar', label: '캘린더', path: '/schedule-calendar' },
    { id: 'schedule-gantt', label: '간트', path: '/schedule-gantt' },
    { id: 'schedule-milestones', label: '마일스톤', path: '/schedule-milestones' },
    { id: 'trip-stats', label: '사후 통계', path: '/trip-stats' },
  ]},
  { id: 'basic', label: '기본정보', pages: [
    { id: 'drivers', label: '자기사', path: '/drivers' },
    { id: 'vehicles', label: '차량', path: '/vehicles' },
    { id: 'staff', label: '담당자', path: '/staff' },
    { id: 'profile', label: '기업 정보', path: '/profile' },
  ]},
]

const NAV_ICONS = {
  dashboard: '▦',
  control: '◎',
  dispatch: '▣',
  basic: '◉',
  customers: '◇',
  schedule: '◷',
}

const MAIN_WITH_SUB = ['dispatch', 'schedule', 'basic', 'customers']

const currentMain = computed(() => route.meta.main || 'dashboard')
const currentPage = computed(() => route.name || 'dashboard')

function isActiveMain(mainId) {
  return currentMain.value === mainId
}
function isActivePage(pageId) {
  return currentPage.value === pageId
}

function gotoPage(path) {
  if (path) router.push(path)
}

/* ── Date ── */
const headerDate = computed(() => {
  const d = new Date()
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
})

/* ── User info ── */
const userName = computed(() => localStorage.getItem('username') || '관리자')
const userRole = computed(() => localStorage.getItem('role') || 'admin')

/* ── Dropdowns ── */
const openDropdown = ref(null)
function toggleDropdown(id) {
  openDropdown.value = openDropdown.value === id ? null : id
}
function closeDropdowns() {
  openDropdown.value = null
}

function logout() {
  localStorage.clear()
  router.push('/login')
}

/* ── Notifications / Chat (existing logic) ── */
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
  if (nb) nb.style.display = locationAlerts.value.length > 0 ? '' : 'none'
}

onMounted(async () => {
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
  <div class="app-shell" @click="closeDropdowns">
    <header class="topbar" id="topBar">
      <button type="button" class="brand" id="brandHome" aria-label="RouteOn 홈" @click="gotoPage('/dashboard')">
        <img class="brand-mark" src="/routeon_logo.png" alt="" aria-hidden="true">
        <span class="brand-text">RouteOn<small>물류 관제</small></span>
      </button>

      <nav class="top-nav" id="navMain" aria-label="주 메뉴">
        <div
          v-for="group in NAV"
          :key="group.id"
          class="nav-main-item"
          :class="{ active: isActiveMain(group.id), 'has-sub': MAIN_WITH_SUB.includes(group.id) }"
          :data-main="group.id"
        >
          <button
            type="button"
            class="nav-pill"
            :class="{ active: isActiveMain(group.id) }"
            :data-main="group.id"
            :title="group.label"
            :aria-haspopup="MAIN_WITH_SUB.includes(group.id) ? 'true' : undefined"
            @click="gotoPage(group.pages[0].path)"
          >
            <span class="nav-pill-icon" aria-hidden="true">{{ NAV_ICONS[group.id] || '•' }}</span>
            <span class="nav-pill-label">{{ group.label }}</span>
          </button>
          <div
            v-if="MAIN_WITH_SUB.includes(group.id)"
            class="nav-sub-flyout"
            role="menu"
            :aria-label="group.label + ' 하위 메뉴'"
          >
            <button
              v-for="page in group.pages"
              :key="page.id"
              type="button"
              class="nav-sub-btn"
              :class="{ active: isActivePage(page.id) }"
              role="menuitem"
              :data-page="page.id"
              @click.stop="gotoPage(page.path)"
            >
              {{ page.label }}
            </button>
          </div>
        </div>
      </nav>

      <div class="topbar-meta">
        <span class="topbar-date">오늘 <strong id="headerDate">{{ headerDate }}</strong></span>
        <button type="button" class="topbar-icon-btn message-btn-wrap" id="messageBtn" title="메시지" aria-label="메시지">💬<span class="notif-dot" id="messageBadge" style="display:none"></span></button>
        <div class="topbar-btn-wrap">
          <button type="button" class="topbar-icon-btn notif-btn-wrap" id="notifBtn" title="알림" aria-label="알림" @click.stop="toggleDropdown('notif')">🔔<span class="notif-dot" id="notifBadge" style="display:none"></span></button>
          <div class="topbar-dropdown" id="notifDropdown" :class="{ open: openDropdown === 'notif' }" style="min-width:220px">
            <div class="topbar-dropdown-header">알림</div>
            <div v-if="!locationAlerts.length" class="topbar-dropdown-empty">새 알림이 없습니다</div>
            <template v-else>
              <button
                v-for="(a, idx) in locationAlerts.slice().reverse()"
                :key="idx"
                type="button"
                class="topbar-dropdown-item"
                @click="gotoPage('/dispatch-manage')"
              >
                🚨 기사 취소 요청 <span class="badge badge-danger" style="margin-left:auto">{{ a.reason }}</span>
              </button>
            </template>
          </div>
        </div>
        <div class="topbar-btn-wrap">
          <button type="button" class="topbar-user-btn" id="userMenuBtn" aria-label="계정 메뉴" aria-haspopup="true" @click.stop="toggleDropdown('user')">👤 <strong id="topbarUserName">{{ userName }}</strong> <small id="topbarUserRole">{{ userRole }}</small></button>
          <div class="topbar-dropdown" id="userDropdown" :class="{ open: openDropdown === 'user' }">
            <div class="topbar-dropdown-header">계정</div>
            <button type="button" class="topbar-dropdown-item" id="ddSettings" @click="gotoPage('/settings')">⚙ 계정 설정</button>
            <hr class="topbar-dropdown-divider">
            <button type="button" class="topbar-dropdown-item topbar-dropdown-item--danger" id="ddLogout" @click="logout">↩ 로그아웃</button>
          </div>
        </div>
      </div>
    </header>
    <main class="content" id="mainContent">
      <section class="page active page-viewport">
        <div class="page-center page-viewport-inner">
          <slot />
        </div>
      </section>
    </main>
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
