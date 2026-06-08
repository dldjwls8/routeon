<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getTrips, deleteTrip as removeTrip, patchTripStatus, reassignTrip } from '@/services/tripService.js'
import { getDrivers } from '@/services/driverService.js'
import { getVehicles } from '@/services/vehicleService.js'
import { TRIP_STATUS_MAP, statusBadgeClass, PAGE_SIZE } from '@/constants.js'

const trips = ref([])
const drivers = ref([])
const vehicles = ref([])
const loading = ref(true)
const tripPage = ref(1)
const selectedTripId = ref(null)
const tripEditMode = ref(false)
const editForm = ref({})

const allRows = computed(() => trips.value)
const rows = computed(() => allRows.value.slice((tripPage.value - 1) * PAGE_SIZE, tripPage.value * PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(allRows.value.length / PAGE_SIZE)))
const selected = computed(() => trips.value.find(t => t.id === selectedTripId.value))

const availableDrivers = computed(() => {
  return drivers.value.filter(d =>
    d.id === selected.value?.driver_id || d.driver_status === '운행가능'
  )
})

function displayTripNo(t) {
  return t?.trip_no || t?.id?.slice(0,8) || '-'
}

function formatDateTimeShort(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).replace('T',' ').slice(0,16)
  return d.toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })
}

async function load() {
  loading.value = true
  try {
    const [data, d, v] = await Promise.all([
      getTrips(),
      getDrivers().catch(() => []),
      getVehicles().catch(() => []),
    ])
    trips.value = Array.isArray(data) ? data : (data.items || [])
    drivers.value = Array.isArray(d) ? d : (d.items || [])
    vehicles.value = Array.isArray(v) ? v : (v.items || [])
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function selectTrip(id) {
  selectedTripId.value = id
  tripEditMode.value = false
  const t = trips.value.find(t => t.id === id)
  if (t) {
    editForm.value = {
      status: t.status,
      driver_id: t.driver_id || null,
      vehicle_id: t.vehicle_id || null,
    }
  }
}

async function deleteTrip() {
  if (!selected.value || !confirm('정말 삭제하시겠습니까?')) return
  try {
    await removeTrip(selected.value.id)
    trips.value = trips.value.filter(t => t.id !== selected.value.id)
    selectedTripId.value = null
  } catch (e) { alert('삭제 실패') }
}

async function updateStatus(status) {
  if (!selected.value) return
  try {
    await patchTripStatus(selected.value.id, status)
    selected.value.status = status
    editForm.value.status = status
  } catch (e) { alert('상태 변경 실패') }
}

async function saveTrip() {
  if (!selected.value) return
  try {
    const body = {}
    if (editForm.value.driver_id !== selected.value.driver_id) {
      body.new_driver_id = editForm.value.driver_id
    }
    if (editForm.value.vehicle_id !== selected.value.vehicle_id) {
      body.new_vehicle_id = editForm.value.vehicle_id
    }
    if (Object.keys(body).length) {
      await reassignTrip(selected.value.id, body)
      const t = trips.value.find(x => x.id === selected.value.id)
      if (t) {
        if (body.new_driver_id) t.driver_id = body.new_driver_id
        if (body.new_vehicle_id) t.vehicle_id = body.new_vehicle_id
      }
    }
    if (editForm.value.status !== selected.value.status) {
      await patchTripStatus(selected.value.id, editForm.value.status)
      const t = trips.value.find(x => x.id === selected.value.id)
      if (t) t.status = editForm.value.status
    }
    tripEditMode.value = false
  } catch (e) {
    alert('저장 실패: ' + (e.message || ''))
  }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="운행 배차 현황" />
    <div class="master-detail-split">
      <div class="master-detail-list">
        <div class="card card-fill">
          <div class="card-hd">
            <h2>배차 목록</h2>
          </div>
          <div class="card-bd master-list-body">
            <div class="table-scroll">
              <table>
                <thead><tr><th>운행번호</th><th>상태</th><th>기사</th><th>차량</th><th>시작</th><th>종료</th></tr></thead>
                <tbody>
                  <tr v-if="!rows.length"><td colspan="6" class="empty-hint">배차 내역이 없습니다.</td></tr>
                  <tr v-for="t in rows" :key="t.id" :class="{ selected: selectedTripId===t.id }" @click="selectTrip(t.id)">
                    <td><strong>{{ displayTripNo(t) }}</strong></td>
                    <td><span class="badge" :class="statusBadgeClass(TRIP_STATUS_MAP[t.status]||t.status)">{{ TRIP_STATUS_MAP[t.status]||t.status }}</span></td>
                    <td>{{ t.driver_name || '—' }}</td>
                    <td>{{ t.vehicle_name || t.vehicle_plate || '—' }}</td>
                    <td>{{ formatDateTimeShort(t.started_at) }}</td>
                    <td>{{ formatDateTimeShort(t.completed_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="pagination">
              <button :disabled="tripPage<=1" @click="tripPage--">‹</button>
              <button v-for="p in totalPages" :key="p" :class="{ active: tripPage===p }" @click="tripPage=p">{{ p }}</button>
              <button :disabled="tripPage>=totalPages" @click="tripPage++">›</button>
              <span>{{ allRows.length }}건</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="selected" class="master-detail-pane">
        <div class="inline-detail">
          <div class="inline-detail-hd">
            <h2>{{ displayTripNo(selected) }}</h2>
            <button type="button" class="detail-close-btn" @click="selectedTripId=null">×</button>
          </div>
          <div class="inline-detail-bd">
            <div v-if="!tripEditMode" class="form-grid" style="max-width:100%">
              <label>운행번호</label><span>{{ displayTripNo(selected) }}</span>
              <label>상태</label><span><span class="badge" :class="statusBadgeClass(TRIP_STATUS_MAP[selected.status]||selected.status)">{{ TRIP_STATUS_MAP[selected.status]||selected.status }}</span></span>
              <label>기사</label><span>{{ selected.driver_name || '—' }}</span>
              <label>차량</label><span>{{ vehicles.find(v=>v.id===selected.vehicle_id)?.plate_number || '—' }}</span>
              <label>시작</label><span>{{ formatDateTimeShort(selected.started_at) }}</span>
              <label>종료</label><span>{{ formatDateTimeShort(selected.completed_at) }}</span>
              <label>거리</label><span>{{ selected.total_distance ? selected.total_distance + 'm' : '—' }}</span>
            </div>
            <div v-else class="form-grid" style="max-width:100%">
              <label>운행번호</label><span>{{ displayTripNo(selected) }}</span>
              <label>상태</label>
              <select v-model="editForm.status" style="max-width:100%;width:100%">
                <option value="scheduled">대기</option>
                <option value="in_progress">운행중</option>
                <option value="completed">완료</option>
                <option value="cancelled">취소</option>
              </select>
              <label>기사</label>
              <select v-model="editForm.driver_id" style="max-width:100%;width:100%">
                <option v-for="d in availableDrivers" :key="d.id" :value="d.id">{{ d.name || d.username }} {{ d.driver_status ? `(${d.driver_status})` : '' }}</option>
              </select>
              <label>차량</label>
              <select v-model="editForm.vehicle_id" style="max-width:100%;width:100%">
                <option v-for="v in vehicles" :key="v.id" :value="v.id">{{ v.plate_number }} ({{ v.vehicle_type }})</option>
              </select>
              <label>시작</label><span>{{ formatDateTimeShort(selected.started_at) }}</span>
              <label>종료</label><span>{{ formatDateTimeShort(selected.completed_at) }}</span>
              <label>거리</label><span>{{ selected.total_distance ? selected.total_distance + 'm' : '—' }}</span>
            </div>
            <div class="trip-handover-actions" style="margin-top:12px">
              <button v-if="selected.status==='scheduled'" type="button" class="btn btn-primary" @click="updateStatus('completed')">완료 처리</button>
              <button v-if="selected.status==='scheduled'" type="button" class="btn btn-sm btn-danger-outline" @click="updateStatus('cancelled')">취소</button>
            </div>
          </div>
          <div class="inline-detail-footer">
            <div class="inline-detail-secondary"><button type="button" class="btn btn-sm btn-danger-outline" @click="deleteTrip">삭제</button></div>
            <div style="display:flex;gap:8px">
              <button v-if="tripEditMode" type="button" class="btn btn-secondary" @click="tripEditMode=false; selectTrip(selectedTripId)">취소</button>
              <button type="button" class="btn btn-primary" @click="tripEditMode ? saveTrip() : (tripEditMode=true)">{{ tripEditMode ? '저장' : '수정' }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="master-detail-pane">
        <div class="detail-empty-hint">배차를 선택하면 상세 정보가 표시됩니다.</div>
      </div>
    </div>
  </div>
</template>
