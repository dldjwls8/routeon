<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getVehicles, deleteVehicle as removeVehicle } from '@/services/vehicleService.js'
import { PAGE_SIZE } from '@/constants.js'

const vehicles = ref([])
const loading = ref(true)
const vehiclePage = ref(1)
const selectedVehicleId = ref(null)

const rows = computed(() => vehicles.value.slice((vehiclePage.value - 1) * PAGE_SIZE, vehiclePage.value * PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(vehicles.value.length / PAGE_SIZE)))
const selected = computed(() => vehicles.value.find(v => v.id === selectedVehicleId.value))

async function load() {
  loading.value = true
  try {
    const data = await getVehicles()
    vehicles.value = Array.isArray(data) ? data : (data.items || [])
  } catch (e) { console.error(e) }
  finally { loading.value = false }
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
                  <tr v-for="v in rows" :key="v.id" :class="{ selected: selectedVehicleId===v.id }" @click="selectedVehicleId=v.id">
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
            <div class="form-grid" style="max-width:100%">
              <label>차량번호</label><span>{{ selected.plate_number || '—' }}</span>
              <label>종류</label><span>{{ selected.type || '—' }}</span>
              <label>상태</label><span>{{ selected.status || '—' }}</span>
              <label>기사</label><span>{{ selected.driver_name || '—' }}</span>
            </div>
          </div>
          <div class="inline-detail-footer">
            <div class="inline-detail-secondary"><button type="button" class="btn btn-sm btn-danger-outline" @click="deleteVehicle">삭제</button></div>
          </div>
        </div>
      </div>
      <div v-else class="master-detail-pane"><div class="detail-empty-hint">차량을 선택하면 상세 정보가 표시됩니다.</div></div>
    </div>
  </div>
</template>
