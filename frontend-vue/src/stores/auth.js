import { reactive, readonly } from 'vue'

/**
 * @file src/stores/auth.js
 * 전역 인증 상태 스토어 (Pinia 마이그레이션 준비)
 */

const state = reactive({
  token: localStorage.getItem('token') || null,
  user: null,
  isReady: false,
})

export function setAuth(token, user = null) {
  state.token = token
  state.user = user
  if (token) {
    localStorage.setItem('token', token)
  } else {
    localStorage.removeItem('token')
  }
}

export function clearAuth() {
  state.token = null
  state.user = null
  localStorage.removeItem('token')
}

export function useAuthStore() {
  return readonly(state)
}
