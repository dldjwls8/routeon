<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { apiGet } from '@/api/client.js'

const vehicles = ref([])
const loading = ref(true)
let ws = null

async function load() {
  try {
    const data = await apiGet('/vehicles')
    vehicles.value = Array.isArray(data) ? data : (data.items || [])
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function connectWs() {
  const base = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${base}//${location.host}/ws/location`
  ws = new WebSocket(url)
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.vehicle_id && msg.lat != null && msg.lon != null) {
        const v = vehicles.value.find(x => String(x.id) === String(msg.vehicle_id))
        if (v) { v.last_lat = msg.lat; v.last_lon = msg.lon }
      }
    } catch {}
  }
}

onMounted(() => { load(); connectWs() })
onUnmounted(() => { if (ws) ws.close() })
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="실시간 차량 위치 및 상태" />
    <div class="control-layout">
      <div class="control-map-panel">
        <div class="control-map-toolbar">
          <div>
            <strong>실시간 관제 지도</strong>
            <span>WebSocket 연결 상태: {{ ws?.readyState === 1 ? '연결됨' : '연결 중…' }}</span>
          </div>
        </div>
        <div class="control-map-card" style="display:flex;align-items:center;justify-content:center;color:var(--t-placeholder)">
          지도 (Kakao Map JS 연동 필요)
        </div>
      </div>
      <div class="control-side-panel">
        <div class="control-metric-grid">
          <div><span>가용 차량</span><strong>{{ vehicles.filter(v=>v.status==='available').length }}</strong></div>
          <div><span>운행 중</span><strong>{{ vehicles.filter(v=>v.status==='busy').length }}</strong></div>
        </div>
        <div class="control-table-card">
          <h2>차량 목록</h2>
          <div class="table-scroll" style="flex:1;min-height:0">
            <table>
              <thead><tr><th>차량</th><th>기사</th><th>상태</th></tr></thead>
              <tbody>
                <tr v-for="v in vehicles" :key="v.id">
                  <td>{{ v.plate_number || v.name || '—' }}</td>
                  <td>{{ v.driver_name || '—' }}</td>
                  <td>{{ v.status || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
