import { reactive, readonly, ref } from 'vue'
import { apiClient } from '@/api/client.js'

const WS_BASE = apiClient.wsBase

const state = reactive({
  connected: false,
  partners: [],
  convByPartner: {},
  currentPartnerId: null,
  currentConvId: null,
  messages: [],
})

const totalUnread = ref(0)
let chatPageActive = false
let ws = null
let pingTimer = null

function getToken() {
  return localStorage.getItem('token') || ''
}

function getWsUrl() {
  return `${WS_BASE}/ws/chat?token=${encodeURIComponent(getToken())}`
}

function updateTotalUnread() {
  totalUnread.value = Object.values(state.convByPartner).reduce(
    (s, c) => s + (c?.unread_count || 0), 0
  )
}

async function loadPartners() {
  try {
    state.partners = await apiClient.get('/chat/partners')
  } catch (e) {
    console.warn('파트너 로드 실패', e)
  }
}

async function loadConversations() {
  try {
    const data = await apiClient.get('/chat/conversations')
    state.convByPartner = {}
    data.forEach(c => {
      state.convByPartner[c.partner.id] = c
    })
    updateTotalUnread()
  } catch (e) {
    console.warn('대화 목록 로드 실패', e)
  }
}

async function fetchMessages(convId, beforeId = null) {
  const p = new URLSearchParams({ limit: '50' })
  if (beforeId) p.set('before_message_id', beforeId)
  const res = await apiClient.fetch(`/chat/conversations/${convId}/messages?${p}`)
  if (!res.ok) return []
  return res.json()
}

async function sendMessage(content) {
  if (!state.currentConvId) return false
  const res = await apiClient.post(
    `/chat/conversations/${state.currentConvId}/messages`,
    { content }
  )
  return res.ok
}

async function markRead() {
  if (!state.currentConvId) return
  const last = state.messages[state.messages.length - 1]
  await apiClient.post(`/chat/conversations/${state.currentConvId}/read`, {
    last_read_message_id: last?.id || null,
  }).catch(() => {})
  if (state.convByPartner[state.currentPartnerId]) {
    state.convByPartner[state.currentPartnerId].unread_count = 0
  }
  updateTotalUnread()
}

async function openConversation(partnerId) {
  state.currentPartnerId = partnerId
  const res = await apiClient.post('/chat/conversations', { partner_id: partnerId })
  if (!res.ok) return null
  const conv = await res.json()
  const prev = state.convByPartner[partnerId]
  state.convByPartner[partnerId] = {
    ...conv,
    last_message: conv.last_message ?? prev?.last_message,
  }
  state.currentConvId = conv.id
  state.messages = []
  const msgs = await fetchMessages(conv.id)
  state.messages = msgs
  await markRead()
  return conv
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  ws = new WebSocket(getWsUrl())
  ws.onopen = () => {
    state.connected = true
    clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 30000)
  }
  ws.onmessage = (e) => {
    if (e.data === 'pong') return
    try {
      const ev = JSON.parse(e.data)
      handleWsEvent(ev)
    } catch (_) {}
  }
  ws.onclose = () => {
    state.connected = false
    clearInterval(pingTimer)
    setTimeout(connect, 5000)
  }
  ws.onerror = () => ws?.close()
}

function handleWsEvent(ev) {
  if (ev.type === 'chat.ready') {
    state.connected = true
  } else if (ev.type === 'chat.message') {
    const matchedConv = Object.values(state.convByPartner).find(
      c => c.id === ev.conversation_id
    )
    const pid = matchedConv?.partner?.id

    if (ev.conversation_id === state.currentConvId && chatPageActive) {
      if (!state.messages.some(m => m.id === ev.message.id)) {
        state.messages.push(ev.message)
      }
      markRead()
    } else {
      if (matchedConv) {
        matchedConv.unread_count = (matchedConv.unread_count || 0) + 1
        updateTotalUnread()
      } else {
        loadConversations()
        return
      }
    }

    if (matchedConv) {
      matchedConv.last_message = ev.message
      matchedConv.updated_at = ev.message.created_at || new Date().toISOString()
    }
  }
}

function disconnect() {
  clearInterval(pingTimer)
  if (ws) {
    ws.close()
    ws = null
  }
  state.connected = false
}

export function useChatSocket() {
  return {
    state: readonly(state),
    totalUnread: readonly(totalUnread),
    connect,
    disconnect,
    loadPartners,
    loadConversations,
    fetchMessages,
    sendMessage,
    markRead,
    openConversation,
    setCurrentPartner: (id) => { state.currentPartnerId = id },
    setCurrentConvId: (id) => { state.currentConvId = id },
    setChatPageActive: (v) => { chatPageActive = v },
  }
}
