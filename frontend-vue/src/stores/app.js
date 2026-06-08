import { reactive, readonly } from 'vue'

/**
 * @file src/stores/app.js
 * 전역 앱 상태 스토어 (테마, 사이드바 등)
 */

const state = reactive({
  sidebarOpen: true,
  theme: localStorage.getItem('theme') || 'light',
})

export function setTheme(theme) {
  state.theme = theme
  localStorage.setItem('theme', theme)
  document.documentElement.setAttribute('data-theme', theme)
}

export function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen
}

export function useAppStore() {
  return readonly(state)
}
