<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getDrivers, patchDriver, deleteDriver as removeDriver } from '@/services/driverService.js'
import { getVehicles } from '@/services/vehicleService.js'
import { PAGE_SIZE } from '@/constants.js'

const drivers = ref([])
const vehicles = ref([])
const loading = ref(true)
const driverPage = ref(1)
const selectedDriverId = ref(null)
const driverEditMode = ref(false)
const editVehicleId = ref(null)

const rows = computed(() => drivers.value.slice((driverPage.value - 1) * PAGE_SIZE, driverPage.value * PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(drivers.value.length / PAGE_SIZE)))
const selected = computed(() => drivers.value.find(d => d.id === selectedDriverId.value))

const assignedVehicleIds = computed(() => new Set(drivers.value.map(d => d.vehicle_id).filter(Boolean)))

const availableVehicles = computed(() => {
  const currentVehicleId = selected.value?.vehicle_id
  return vehicles.value.filter(v => {
    if (v.id === currentVehicleId) return true
    return !assignedVehicleIds.value.has(v.id)
  })
})

async function load() {
  loading.value = true
  try {
    const [dData, vData] = await Promise.all([
      getDrivers(),
      getVehicles().catch(() => [])
    ])
    drivers.value = Array.isArray(dData) ? dData : (dData.items || [])
    vehicles.value = Array.isArray(vData) ? vData : (vData.items || [])
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function selectDriver(id) {
  selectedDriverId.value = id
  driverEditMode.value = false
  const d = drivers.value.find(x => x.id === id)
  editVehicleId.value = d?.vehicle_id || null
}

async function saveDriver() {
  if (!selected.value) return
  try {
    const payload = { vehicle_id: editVehicleId.value || undefined }
    await patchDriver(selected.value.id, payload)
    driverEditMode.value = false
    await load()
  } catch (e) {
    alert('저장 실패: ' + (e.message || ''))
  }
}

async function deleteDriver() {
  if (!selected.value || !confirm('정말 삭제하시겠습니까?')) return
  try {
    await removeDriver(selected.value.id)
    drivers.value = drivers.value.filter(d => d.id !== selected.value.id)
    selectedDriverId.value = null
  } catch (e) { alert('삭제 실패') }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="자기사 관리" />
    <div class="master-detail-split">
      <div class="master-detail-list">
        <div class="card card-fill">
          <div class="card-hd"><h2>기사 목록</h2></div>
          <div class="card-bd master-list-body">
            <div class="table-scroll">
              <table>
                <thead><tr><th>이름</th><th>연락처</th><th>면허</th><th>차량</th></tr></thead>
                <tbody>
                  <tr v-if="!rows.length"><td colspan="4" class="empty-hint">기사가 없습니다.</td></tr>
                  <tr v-for="d in rows" :key="d.id" :class="{ selected: selectedDriverId===d.id }" @click="selectDriver(d.id)">
                    <td><strong>{{ d.name }}</strong></td>
                    <td>{{ d.phone || '—' }}</td>
                    <td>{{ d.license_type || '—' }}</td>
                    <td>{{ d.vehicle_name || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="pagination">
              <button :disabled="driverPage<=1" @click="driverPage--">‹</button>
              <button v-for="p in totalPages" :key="p" :class="{ active: driverPage===p }" @click="driverPage=p">{{ p }}</button>
              <button :disabled="driverPage>=totalPages" @click="driverPage++">›</button>
              <span>{{ drivers.length }}건</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="selected" class="master-detail-pane">
        <div class="inline-detail">
          <div class="inline-detail-hd">
            <h2>{{ selected.name }}</h2>
            <button type="button" class="detail-close-btn" @click="selectedDriverId=null">×</button>
          </div>
          <div class="inline-detail-bd">
            <div v-if="!driverEditMode" class="form-grid" style="max-width:100%">
              <label>이름</label><span>{{ selected.name }}</span>
              <label>연락처</label><span>{{ selected.phone || '—' }}</span>
              <label>면허</label><span>{{ selected.license_type || '—' }}</span>
              <label>차량</label><span>{{ selected.vehicle_name || '—' }}</span>
            </div>
            <div v-else class="form-grid" style="max-width:100%">
              <label>이름</label><span>{{ selected.name }}</span>
              <label>연락처</label><span>{{ selected.phone || '—' }}</span>
              <label>면허</label><span>{{ selected.license_type || '—' }}</span>
              <label>배정 차량</label>
              <select v-model="editVehicleId">
                <option :value="null">미배정</option>
                <option v-for="v in availableVehicles" :key="v.id" :value="v.id">{{ v.plate_number || v.name || v.vehicle_type }}</option>
              </select>
            </div>
          </div>
          <div class="inline-detail-footer">
            <div class="inline-detail-secondary"><button type="button" class="btn btn-sm btn-danger-outline" @click="deleteDriver">삭제</button></div>
            <div style="display:flex;gap:8px">
              <button v-if="driverEditMode" type="button" class="btn btn-secondary" @click="driverEditMode=false; selectDriver(selectedDriverId)">취소</button>
              <button type="button" class="btn btn-primary" @click="driverEditMode ? saveDriver() : (driverEditMode=true)">{{ driverEditMode ? '저장' : '수정' }}</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="master-detail-pane"><div class="detail-empty-hint">기사를 선택하면 상세 정보가 표시됩니다.</div></div>
    </div>
  </div>
</template>
