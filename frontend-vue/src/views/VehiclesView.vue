<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getVehicles, patchVehicle, deleteVehicle as removeVehicle } from '@/services/vehicleService.js'
import { getDrivers } from '@/services/driverService.js'
import { PAGE_SIZE } from '@/constants.js'

const vehicles = ref([])
const drivers = ref([])
const loading = ref(true)
const vehiclePage = ref(1)
const selectedVehicleId = ref(null)
const vehicleEditMode = ref(false)
const editDriverId = ref(null)

const rows = computed(() => vehicles.value.slice((vehiclePage.value - 1) * PAGE_SIZE, vehiclePage.value * PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(vehicles.value.length / PAGE_SIZE)))
const selected = computed(() => vehicles.value.find(v => v.id === selectedVehicleId.value))

const assignedDriverIds = computed(() => new Set(vehicles.value.map(v => v.driver_id).filter(Boolean)))

const availableDrivers = computed(() => {
  const currentDriverId = selected.value?.driver_id
  return drivers.value.filter(d => {
    if (d.id === currentDriverId) return true
    return !assignedDriverIds.value.has(d.id)
  })
})

async function load() {
  loading.value = true
  try {
    const [vData, dData] = await Promise.all([
      getVehicles(),
      getDrivers().catch(() => [])
    ])
    vehicles.value = Array.isArray(vData) ? vData : (vData.items || [])
    drivers.value = Array.isArray(dData) ? dData : (dData.items || [])
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function selectVehicle(id) {
  selectedVehicleId.value = id
  vehicleEditMode.value = false
  const v = vehicles.value.find(x => x.id === id)
  editDriverId.value = v?.driver_id || null
}

async function saveVehicle() {
  if (!selected.value) return
  try {
    const payload = { driver_id: editDriverId.value || undefined }
    await patchVehicle(selected.value.id, payload)
    vehicleEditMode.value = false
    await load()
  } catch (e) {
    alert('저장 실패: ' + (e.message || ''))
  }
}

async function deleteVehicle() {
  if (!selected.value || !confirm('정말 삭제하시겠습니까?')) return
  try {
    await removeVehicle(selected.value.id)
    vehicles.value = vehicles.value.filter(v => v.id !== selected.value.id)
    selectedVehicleId.value = null
  } catch (e) { alert('삭제 실패') }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="차량 관리" />
    <div class="master-detail-split">
      <div class="master-detail-list">
        <div class="card card-fill">
          <div class="card-hd"><h2>차량 목록</h2></div>
          <div class="card-bd master-list-body">
            <div class="table-scroll">
              <table>
                <thead><tr><th>차량번호</th><th>종류</th><th>상태</th><th>기사</th></tr></thead>
                <tbody>
                  <tr v-if="!rows.length"><td colspan="4" class="empty-hint">차량이 없습니다.</td></tr>
                  <tr v-for="v in rows" :key="v.id" :class="{ selected: selectedVehicleId===v.id }" @click="selectVehicle(v.id)">
                    <td><strong>{{ v.plate_number || v.name || '—' }}</strong></td>
                    <td>{{ v.type || '—' }}</td>
                    <td>{{ v.status || '—' }}</td>
                    <td>{{ v.driver_name || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="pagination">
              <button :disabled="vehiclePage<=1" @click="vehiclePage--">‹</button>
              <button v-for="p in totalPages" :key="p" :class="{ active: vehiclePage===p }" @click="vehiclePage=p">{{ p }}</button>
              <button :disabled="vehiclePage>=totalPages" @click="vehiclePage++">›</button>
              <span>{{ vehicles.length }}건</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="selected" class="master-detail-pane">
        <div class="inline-detail">
          <div class="inline-detail-hd">
            <h2>{{ selected.plate_number || selected.name }}</h2>
            <button type="button" class="detail-close-btn" @click="selectedVehicleId=null">×</button>
          </div>
          <div class="inline-detail-bd">
            <div v-if="!vehicleEditMode" class="form-grid" style="max-width:100%">
              <label>차량번호</label><span>{{ selected.plate_number || '—' }}</span>
              <label>종류</label><span>{{ selected.type || '—' }}</span>
              <label>상태</label><span>{{ selected.status || '—' }}</span>
              <label>기사</label><span>{{ selected.driver_name || '—' }}</span>
            </div>
            <div v-else class="form-grid" style="max-width:100%">
              <label>차량번호</label><span>{{ selected.plate_number || '—' }}</span>
              <label>종류</label><span>{{ selected.type || '—' }}</span>
              <label>상태</label><span>{{ selected.status || '—' }}</span>
              <label>기사 연결</label>
              <select v-model="editDriverId">
                <option :value="null">미배정</option>
                <option v-for="d in availableDrivers" :key="d.id" :value="d.id">{{ d.name || d.username }}</option>
              </select>
            </div>
          </div>
          <div class="inline-detail-footer">
            <div class="inline-detail-secondary"><button type="button" class="btn btn-sm btn-danger-outline" @click="deleteVehicle">삭제</button></div>
            <div style="display:flex;gap:8px">
              <button v-if="vehicleEditMode" type="button" class="btn btn-secondary" @click="vehicleEditMode=false; selectVehicle(selectedVehicleId)">취소</button>
              <button type="button" class="btn btn-primary" @click="vehicleEditMode ? saveVehicle() : (vehicleEditMode=true)">{{ vehicleEditMode ? '저장' : '수정' }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="master-detail-pane"><div class="detail-empty-hint">차량을 선택하면 상세 정보가 표시됩니다.</div></div>
    </div>
  </div>
</template>
