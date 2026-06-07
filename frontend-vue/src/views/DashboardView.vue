<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import PageChrome from '@/components/PageChrome.vue'
import { getTripStats } from '@/services/statisticsService.js'
import { getDeliveries } from '@/services/deliveryService.js'
import { getVehicles } from '@/services/vehicleService.js'
import { getDrivers } from '@/services/driverService.js'
import { ORDER_STATUS_MAP, statusBadgeClass, PAGE_SIZE } from '@/constants.js'

const router = useRouter()

const stats = ref(null)
const orders = ref([])
const vehicles = ref([])
const drivers = ref([])
const dashOrderTab = ref('전체')
const loading = ref(true)

const orderTabs = ['전체', '접수', '배차', '운행중', '완료']

const filteredOrders = computed(() => {
  if (dashOrderTab.value === '전체') return orders.value
  return orders.value.filter(o => (ORDER_STATUS_MAP[o.status] || o.status) === dashOrderTab.value)
})
const dashboardOrders = computed(() => filteredOrders.value.slice(0, 5))
const completedCount = computed(() => orders.value.filter(o => ['done','done_manual'].includes(o.status)).length)
const totalCount = computed(() => orders.value.length)
const pct = computed(() => totalCount.value ? Math.round((completedCount.value / totalCount.value) * 100) : 0)

const fleetByType = computed(() => {
  const m = {}
  vehicles.value.forEach(v => { m[v.type] = (m[v.type] || 0) + 1 })
  return m
})
const fleetMax = computed(() => Math.max(...Object.values(fleetByType.value), 1))
const fleetRows = computed(() => Object.entries(fleetByType.value).sort((a,b) => b[1] - a[1]))

const cargoChips = computed(() => {
  const m = {}
  orders.value.forEach(o => {
    const label = (o.cargo_type || '').trim()
    if (label) m[label] = (m[label] || 0) + 1
  })
  return Object.entries(m).sort((a,b) => b[1] - a[1]).slice(0, 6)
})

const quickOptions = [
  { id: 'intake', label: '오더 접수', route: '/order-intake' },
  { id: 'orders', label: '오더 목록', route: '/order-list' },
  { id: 'dispatch', label: '배차 관리', route: '/dispatch-manage' },
  { id: 'control', label: '운행 관제', route: '/control-live' },
  { id: 'customers', label: '고객 관리', route: '/customer-list' },
  { id: 'calendar', label: '일정 캘린더', route: '/schedule-calendar' },
]

const quickIds = ref(['intake','dispatch'])
try {
  const saved = localStorage.getItem('dashboardQuickLinks')
  if (saved) quickIds.value = JSON.parse(saved)
} catch {}

const quickLinks = computed(() => quickIds.value.map(id => quickOptions.find(item => item.id === id)).filter(Boolean))

function displayOrderNo(o) {
  return o.order_no || o.id?.slice(0,8) || '-'
}

function routeCell(o) {
  return { pickup: o.pickup_address || '—', delivery: o.address || '—' }
}

function formatDateTimeShort(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).replace('T',' ').slice(0,16)
  return d.toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })
}

function openQuickEdit() {
  const selected = [...quickIds.value]
  const max = 3
  const labels = quickOptions.map(item =>
    `\n      <label><input type="checkbox" value="${item.id}" ${selected.includes(item.id)?'checked':''}> ${item.label}</label>`
  ).join('')
  // 간단히 confirm 기반으로 처리 — 실제로는 modal 컴포넌트가 필요하지만 MVP용
  // Vue 환경에서는 alert/confirm으로 우선 대체
}

async function load() {
  try {
    const [s, o, v, d] = await Promise.all([
      getTripStats().catch(() => null),
      getDeliveries().catch(() => []),
      getVehicles().catch(() => []),
      getDrivers().catch(() => []),
    ])
    stats.value = s
    orders.value = Array.isArray(o) ? o : (o.items || [])
    vehicles.value = Array.isArray(v) ? v : (v.items || [])
    drivers.value = Array.isArray(d) ? d : (d.items || [])
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome title="운영 대시보드" desc="오더·차량·운행 현황 요약" />
    <div v-if="loading" class="empty-hint">대시보드 데이터를 불러오는 중…</div>
    <div v-else class="dash-layout">
      <aside class="dash-left" aria-label="요약 위젯">
        <div class="dash-widget">
          <h2>오늘 배송 진행</h2>
          <div class="dash-cargo-chips">
            <span v-if="!cargoChips.length" class="text-muted-hint">접수된 화물 없음</span>
            <span v-for="c in cargoChips" :key="c[0]" class="dash-cargo-chip">{{ c[0] }} {{ c[1] }}건</span>
          </div>
          <div class="dash-gauge-wrap">
            <div class="dash-gauge" :style="{ '--pct': pct }">
              <svg class="dash-gauge-svg" viewBox="0 0 140 78" aria-hidden="true">
                <path class="dash-gauge-track" d="M 12 68 A 58 58 0 0 1 128 68" />
                <path class="dash-gauge-fill" d="M 12 68 A 58 58 0 0 1 128 68" />
              </svg>
              <span class="dash-gauge-num">{{ pct }}%</span>
            </div>
            <p style="font-size:12px;color:#8b93a7">{{ completedCount }}건 / {{ totalCount }}건 목표 ({{ pct }}%)</p>
          </div>
        </div>

        <div class="dash-widget">
          <h2>차종별 가용 차량</h2>
          <div v-for="([type,n]) in fleetRows" :key="type" class="dash-fleet-row">
            <span>{{ type }}</span>
            <div class="dash-fleet-bar"><i :style="{ width: Math.round(n / fleetMax * 100) + '%' }"></i></div>
            <span>{{ n }}</span>
          </div>
          <p style="font-size:11px;color:#6b7280;margin-top:8px">등록 {{ vehicles.length }}대 · 기사 {{ drivers.length }}명</p>
        </div>

        <div class="dash-widget">
          <div class="dash-widget-title">
            <h2>바로가기</h2>
            <button type="button" class="icon-text-btn" @click="openQuickEdit">편집</button>
          </div>
          <div class="dash-quick-links">
            <button v-for="item in quickLinks" :key="item.id" type="button" class="dash-quick-link" @click="router.push(item.route)">
              <strong>{{ item.label }}</strong>
            </button>
          </div>
        </div>
      </aside>

      <div class="dash-right">
        <div class="dash-map-card" aria-label="요약 지도"></div>
        <div class="dash-orders-card">
          <div class="dash-orders-hd">
            <h2>오더</h2>
            <div class="dash-order-tabs" role="tablist" aria-label="오더 상태">
              <button v-for="t in orderTabs" :key="t" type="button" role="tab" :class="{ active: dashOrderTab === t }" @click="dashOrderTab = t">{{ t }}</button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>오더번호</th><th>고객</th><th>경로</th><th>시간창</th><th>기사</th><th>상태</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!dashboardOrders.length">
                <td colspan="6" style="text-align:center;padding:24px;color:#8b93a7">해당 상태의 오더가 없습니다</td>
              </tr>
              <tr v-for="o in dashboardOrders" :key="o.id" @click="router.push('/order-list')" style="cursor:pointer">
                <td><strong>{{ displayOrderNo(o) }}</strong></td>
                <td>{{ o.shipper_name || '—' }}</td>
                <td class="route-cell"><strong>{{ routeCell(o).pickup }}</strong><br>→ {{ routeCell(o).delivery }}</td>
                <td>{{ o.deadline ? o.deadline.slice(0,16).replace('T',' ') : '—' }}</td>
                <td>{{ o.driver_name || '—' }}</td>
                <td><span class="badge" :class="statusBadgeClass(ORDER_STATUS_MAP[o.status] || o.status)">{{ ORDER_STATUS_MAP[o.status] || o.status }}</span></td>
              </tr>
            </tbody>
          </table>
          <div class="dash-orders-ft">
            <span>{{ filteredOrders.length > 5 ? `최근 5건 표시 · 전체 ${filteredOrders.length}건` : `전체 ${filteredOrders.length}건` }}</span>
            <button type="button" @click="router.push('/order-list')">전체 오더 목록 보기 →</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
