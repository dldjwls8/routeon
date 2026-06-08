<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getDeliveries, deleteDelivery } from '@/services/deliveryService.js'
import { ORDER_STATUS_MAP, statusBadgeClass, PAGE_SIZE } from '@/constants.js'

const orders = ref([])
const loading = ref(true)
const orderFilter = ref('전체')
const orderSearch = ref('')
const orderPage = ref(1)
const selectedOrderId = ref(null)
const orderEditMode = ref(false)

const statuses = ['전체', '접수', '배차대기', '배차', '운행중', '완료', '취소']

const allRows = computed(() => {
  let rows = orders.value
  if (orderFilter.value !== '전체') {
    rows = rows.filter(o => {
      const s = ORDER_STATUS_MAP[o.status] || o.status
      if (orderFilter.value === '배차대기') return s === '접수' && !o.driver_id
      return s === orderFilter.value
    })
  }
  const q = orderSearch.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter(o => {
      const texts = [
        o.order_no, o.shipper_name, o.pickup_address, o.address,
        o.cargo_type, o.cargo_weight_ton, o.driver_name,
      ].map(v => String(v || '').toLowerCase())
      return texts.some(t => t.includes(q))
    })
  }
  return rows
})

const rows = computed(() => allRows.value.slice((orderPage.value - 1) * PAGE_SIZE, orderPage.value * PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(allRows.value.length / PAGE_SIZE)))

const selected = computed(() => orders.value.find(o => o.id === selectedOrderId.value))

function displayOrderNo(o) {
  return o?.order_no || o?.id?.slice(0,8) || '-'
}

function formatDateTimeShort(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).replace('T',' ').slice(0,16)
  return d.toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })
}

function mixedLoadBadge(mixed) {
  return mixed ? '<span class="badge badge-temp">혼적</span>' : '—'
}

function isMixedLoad(o) {
  return !!o.mixed_load
}

function orderIsEditable(o) {
  return ['pending','assigned'].includes(o.status)
}

function orderCanDelete(o) {
  return ['pending','cancelled'].includes(o.status)
}

function routeCellHtml(o) {
  return `<strong>${o.pickup_address || '—'}</strong><br>→ ${o.address || '—'}`
}

async function load() {
  loading.value = true
  try {
    const data = await getDeliveries()
    orders.value = Array.isArray(data) ? data : (data.items || [])
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function selectOrder(id) {
  selectedOrderId.value = id
  orderEditMode.value = false
}

async function deleteOrder() {
  if (!selected.value || !confirm('정말 삭제하시겠습니까?')) return
  try {
    await deleteDelivery(selected.value.id)
    orders.value = orders.value.filter(o => o.id !== selected.value.id)
    selectedOrderId.value = null
  } catch (e) {
    alert('삭제 실패')
  }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="좌측 목록 · 우측 상세에서 수정" />
    <div class="master-detail-split">
      <div class="master-detail-list">
        <div class="card card-fill">
          <div class="card-hd">
            <h2>오더 목록</h2>
            <div class="chips" id="orderChips">
              <button v-for="s in statuses" :key="s" type="button" class="chip" :class="{ active: orderFilter === s }" @click="orderFilter=s; orderPage=1; selectedOrderId=null">{{ s }}</button>
            </div>
            <input v-model="orderSearch" type="search" class="search" placeholder="오더번호·화주·상하차지·화물 검색" @input="orderPage=1">
          </div>
          <div class="card-bd master-list-body">
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>상태</th><th>접수 시간</th><th>혼적</th><th>상차지/하차지</th><th>화물</th><th>화주</th><th>기사</th><th>오더번호</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!rows.length">
                    <td colspan="8" class="empty-hint" style="padding:20px">해당 상태의 오더가 없습니다.</td>
                  </tr>
                  <tr v-for="o in rows" :key="o.id" :class="{ selected: selectedOrderId===o.id }" @click="selectOrder(o.id)" class="order-row-clickable"
                  >
                    <td>
                      <span class="badge" :class="statusBadgeClass(ORDER_STATUS_MAP[o.status]||o.status)">{{ ORDER_STATUS_MAP[o.status]||o.status }}</span>
                      <span v-if="orderIsEditable(o)" class="badge-edit">수정</span>
                    </td>
                    <td>{{ formatDateTimeShort(o.created_at) }}</td>
                    <td><span v-html="mixedLoadBadge(isMixedLoad(o))"></span></td>
                    <td class="route-cell" v-html="routeCellHtml(o)"></td>
                    <td>{{ o.cargo_type || '—' }}{{ o.cargo_size ? ` · ${o.cargo_size}` : '' }}{{ o.cargo_weight_ton != null ? ` · ${o.cargo_weight_ton}톤` : '' }}</td>
                    <td>{{ o.shipper_name || '—' }}</td>
                    <td>{{ o.driver_name || '—' }}</td>
                    <td><strong>{{ displayOrderNo(o) }}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="pagination">
              <button :disabled="orderPage<=1" @click="orderPage--">‹</button>
              <button v-for="p in totalPages" :key="p" :class="{ active: orderPage===p }" @click="orderPage=p">{{ p }}</button>
              <button :disabled="orderPage>=totalPages" @click="orderPage++">›</button>
              <span>{{ allRows.length }}건</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="selected" class="master-detail-pane">
        <div class="inline-detail">
          <div class="inline-detail-hd">
            <h2>{{ displayOrderNo(selected) }} · {{ selected.shipper_name || '—' }}</h2>
            <button type="button" class="detail-close-btn" @click="selectedOrderId=null">×</button>
          </div>
          <div class="inline-detail-bd">
            <div class="form-grid" style="max-width:100%">
              <label>오더번호</label><span>{{ displayOrderNo(selected) }}</span>
              <label>상태</label><span><span class="badge" :class="statusBadgeClass(ORDER_STATUS_MAP[selected.status]||selected.status)">{{ ORDER_STATUS_MAP[selected.status]||selected.status }}</span></span>
              <label>화주</label><span>{{ selected.shipper_name || '—' }}</span>
              <label>상차지</label><span>{{ selected.pickup_address || '—' }}</span>
              <label>하차지</label><span>{{ selected.address || '—' }}</span>
              <label>화물</label><span>{{ selected.cargo_type || '—' }} {{ selected.cargo_size ? `· ${selected.cargo_size}` : '' }}{{ selected.cargo_weight_ton != null ? ` · ${selected.cargo_weight_ton}톤` : '' }}</span>
              <label>기사</label><span>{{ selected.driver_name || '—' }}</span>
              <label>혼적</label><span>{{ selected.mixed_load ? '혼적' : '단독' }}</span>
            </div>
          </div>
          <div class="inline-detail-footer">
            <div class="inline-detail-secondary">
              <button v-if="orderCanDelete(selected)" type="button" class="btn btn-sm btn-danger-outline" @click="deleteOrder">오더 삭제</button>
            </div>
            <div><button type="button" class="btn btn-primary" @click="orderEditMode=!orderEditMode">{{ orderEditMode ? '저장' : '수정' }}</button></div>
          </div>
        </div>
      </div>
      <div v-else class="master-detail-pane">
        <div class="detail-empty-hint">오더를 선택하면 상세 정보가 표시됩니다.</div>
      </div>
    </div>
  </div>
</template>
