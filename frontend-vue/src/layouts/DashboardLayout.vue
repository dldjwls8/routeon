<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useChatSocket } from '@/composables/useChatSocket.js'

const router = useRouter()
const chat = useChatSocket()
const dropdownOpen = ref(false)

const unreadEntries = computed(() =>
  Object.entries(chat.state.convByPartner || {})
    .filter(([, c]) => (c?.unread_count || 0) > 0)
    .map(([pid, c]) => [pid, c.unread_count])
)

function partnerName(pid) {
  const p = chat.state.value?.partners?.find(x => x.id === pid)
  return p?.name || p?.username || '사용자'
}

function goToChat(partnerId = null) {
  dropdownOpen.value = false
  if (partnerId) {
    router.push(`/chat?partner_id=${partnerId}`)
  } else {
    router.push('/chat')
  }
}

function toggleDropdown(e) {
  e.stopPropagation()
  dropdownOpen.value = !dropdownOpen.value
}

function closeDropdown() {
  dropdownOpen.value = false
}

onMounted(() => {
  chat.connect()
  chat.loadPartners()
  chat.loadConversations()
  document.addEventListener('click', closeDropdown)
})

onUnmounted(() => {
  chat.disconnect()
  document.removeEventListener('click', closeDropdown)
})
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
        <button type="button" class="topbar-icon-btn message-btn-wrap" title="메시지" aria-label="메시지" @click="goToChat()">
          💬<span v-if="chat.totalUnread.value > 0" class="notif-dot"></span>
        </button>
        <div class="topbar-btn-wrap">
          <button type="button" class="topbar-icon-btn notif-btn-wrap" title="알림" aria-label="알림" @click="toggleDropdown">
            🔔<span v-if="chat.totalUnread.value > 0" class="notif-dot"></span>
          </button>
          <div v-show="dropdownOpen" class="topbar-dropdown open" style="min-width:220px">
            <div class="topbar-dropdown-header">새 메시지</div>
            <template v-if="unreadEntries.length">
              <button
                v-for="[pid, count] in unreadEntries"
                :key="pid"
                type="button"
                class="topbar-dropdown-item"
                @click="goToChat(pid)"
              >
                💬 {{ partnerName(pid) }}<span class="badge badge-info" style="margin-left:auto">{{ count > 99 ? '99+' : count }}</span>
              </button>
            </template>
            <div v-else class="topbar-dropdown-empty">새 알림이 없습니다</div>
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
