<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getDrivers, deleteDriver as removeDriver } from '@/services/driverService.js'
import { PAGE_SIZE } from '@/constants.js'

const drivers = ref([])
const loading = ref(true)
const driverPage = ref(1)
const selectedDriverId = ref(null)

const rows = computed(() => drivers.value.slice((driverPage.value - 1) * PAGE_SIZE, driverPage.value * PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(drivers.value.length / PAGE_SIZE)))
const selected = computed(() => drivers.value.find(d => d.id === selectedDriverId.value))

async function load() {
  loading.value = true
  try {
    const data = await getDrivers()
    drivers.value = Array.isArray(data) ? data : (data.items || [])
  } catch (e) { console.error(e) }
  finally { loading.value = false }
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
                  <tr v-for="d in rows" :key="d.id" :class="{ selected: selectedDriverId===d.id }" @click="selectedDriverId=d.id">
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
            <div class="form-grid" style="max-width:100%">
              <label>이름</label><span>{{ selected.name }}</span>
              <label>연락처</label><span>{{ selected.phone || '—' }}</span>
              <label>면허</label><span>{{ selected.license_type || '—' }}</span>
              <label>차량</label><span>{{ selected.vehicle_name || '—' }}</span>
            </div>
          </div>
          <div class="inline-detail-footer">
            <div class="inline-detail-secondary"><button type="button" class="btn btn-sm btn-danger-outline" @click="deleteDriver">삭제</button></div>
          </div>
        </div>
      </div>
      <div v-else class="master-detail-pane"><div class="detail-empty-hint">기사를 선택하면 상세 정보가 표시됩니다.</div></div>
    </div>
  </div>
</template>
