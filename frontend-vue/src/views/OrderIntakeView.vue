<script setup>
import { ref, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getCustomers } from '@/services/customerService.js'
import { getVehicles } from '@/services/vehicleService.js'
import { getDrivers } from '@/services/driverService.js'
import { createDelivery, createDeliveriesBatch } from '@/services/deliveryService.js'
import { apiFetch } from '@/api/client.js'
import * as XLSX from 'xlsx'
import { rowsFromExcelOrder, generateIntakeTemplate } from '@/utils/excelParser.js'
import { toDeliveryBatchPayload } from '@/utils/deliveryBatch.js'

const customers = ref([])
const vehicles = ref([])
const drivers = ref([])
const loading = ref(false)
const submitted = ref(false)
const activeTab = ref('single')

const form = ref({
  shipper_name: '',
  pickup_address: '',
  address: '',
  cargo_type: '',
  cargo_size: '',
  cargo_weight_ton: '',
  pickup_cargo_weight_ton: '',
  contact_phone: '',
  mixed_load: false,
})

const selectedCustomerId = ref(null)

function onCustomerChange() {
  const c = customers.value.find(x => x.id == selectedCustomerId.value)
  if (c) {
    form.value.shipper_name = c.name
    form.value.contact_phone = c.phone || ''
  } else {
    form.value.shipper_name = ''
    form.value.contact_phone = ''
  }
}

// 엑셀 일괄 접수 상태
const excelLoading = ref(false)
const excelError = ref('')
const parsedRows = ref([])

async function load() {
  try {
    const [c, v, d] = await Promise.all([
      getCustomers().catch(()=>[]),
      getVehicles().catch(()=>[]),
      getDrivers().catch(()=>[]),
    ])
    customers.value = Array.isArray(c) ? c : (c.items||[])
    vehicles.value = Array.isArray(v) ? v : (v.items||[])
    drivers.value = Array.isArray(d) ? d : (d.items||[])
  } catch (e) { console.error(e) }
}

async function submit() {
  loading.value = true
  try {
    await createDelivery(form.value)
    submitted.value = true
    setTimeout(() => submitted.value = false, 2000)
    Object.keys(form.value).forEach(k => { form.value[k] = k==='mixed_load'?false:'' })
    selectedCustomerId.value = null
  } catch (e) { alert('접수 실패') }
  finally { loading.value = false }
}

function onFileChange(e) {
  const file = e.target.files[0]
  if (!file) return
  excelError.value = ''
  parsedRows.value = []
  const reader = new FileReader()
  reader.onload = async (evt) => {
    try {
      const data = new Uint8Array(evt.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawJson = XLSX.utils.sheet_to_json(firstSheet)
      if (!rawJson.length) {
        excelError.value = '엑셀에 데이터가 없습니다.'
        return
      }
      let allRows = []
      rawJson.forEach(rawRow => {
        const rows = rowsFromExcelOrder(rawRow)
        allRows.push(...rows)
      })
      if (!allRows.length) {
        excelError.value = '유효한 오더 데이터를 찾을 수 없습니다.'
        return
      }
      for (const row of allRows) {
        if (row.pickup) {
          const res = await apiFetch(`/address/coord?query=${encodeURIComponent(row.pickup)}`)
          if (res.ok) {
            const coord = await res.json().catch(() => null)
            if (coord) { row.pickup_lat = coord.lat; row.pickup_lon = coord.lon }
          }
        }
        if (row.delivery) {
          const res = await apiFetch(`/address/coord?query=${encodeURIComponent(row.delivery)}`)
          if (res.ok) {
            const coord = await res.json().catch(() => null)
            if (coord) { row.lat = coord.lat; row.lon = coord.lon }
          }
        }
      }
      parsedRows.value = allRows
    } catch (err) {
      console.error(err)
      excelError.value = '엑셀 파싱 오류: ' + (err.message || '')
    }
  }
  reader.readAsArrayBuffer(file)
}

async function submitExcelBatch() {
  if (!parsedRows.value.length) return
  excelLoading.value = true
  try {
    const payload = toDeliveryBatchPayload(parsedRows.value)
    await createDeliveriesBatch(payload)
    alert(`${payload.length}건 접수 완료`)
    parsedRows.value = []
  } catch (e) {
    alert('일괄 접수 실패: ' + (e.message || ''))
  } finally {
    excelLoading.value = false
  }
}

async function downloadTemplate() {
  const res = await fetch('/api/templates/orders')
  if (!res.ok) {
    alert('양식 다운로드에 실패했습니다.')
    return
  }
  const blob = await res.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'demo_orders.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="신규 오더 접수" />
    <div class="intake-layout-wrap">
      <div class="intake-main">
        <div class="card">
          <div class="card-hd">
            <div class="tab-bar">
              <button class="tab" :class="{active: activeTab==='single'}" @click="activeTab='single'">단건 접수</button>
              <button class="tab" :class="{active: activeTab==='excel'}" @click="activeTab='excel'">엑셀 일괄 접수</button>
            </div>
          </div>
          <div class="card-bd">
            <!-- 단건 접수 -->
            <div v-if="activeTab==='single'" class="form-grid" style="max-width:100%">
              <label>화주</label>
              <div style="display:flex;gap:8px;flex-direction:column">
                <select v-model="selectedCustomerId" @change="onCustomerChange">
                  <option :value="null">직접 입력</option>
                  <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
                <input v-model="form.shipper_name" :readonly="!!selectedCustomerId" placeholder="화주명">
              </div>
              <label>상차지</label><input v-model="form.pickup_address" placeholder="상차지 주소">
              <label>상차 중량(톤)</label><input v-model="form.pickup_cargo_weight_ton" placeholder="예: 5.0">
              <label>하차지 *</label><input v-model="form.address" placeholder="하차지 주소">
              <label>화물</label><input v-model="form.cargo_type" placeholder="화물 종류">
              <label>화물 크기</label><input v-model="form.cargo_size" placeholder="예: 5톤">
              <label>하차 중량(톤)</label><input v-model="form.cargo_weight_ton" placeholder="예: 2.0">
              <label>연락처</label><input v-model="form.contact_phone" placeholder="연락처">
              <label>혼적</label>
              <label class="radio-label"><input type="checkbox" v-model="form.mixed_load"> 혼적 허용</label>
            </div>

            <!-- 엑셀 일괄 접수 -->
            <div v-else>
              <div class="excel-actions">
                <input type="file" accept=".xlsx,.xls,.csv" @change="onFileChange">
                <button type="button" class="btn btn-secondary btn-sm" @click="downloadTemplate">양식 다운로드</button>
              </div>
              <p v-if="excelError" class="error-text">{{ excelError }}</p>
              <div v-if="parsedRows.length" class="preview-table-wrap">
                <p class="text-muted">총 {{ parsedRows.length }}건 파싱됨</p>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>화주</th>
                      <th>상차지</th>
                      <th>상차화물</th>
                      <th>상차규격</th>
                      <th>상차중량(톤)</th>
                      <th>하차지</th>
                      <th>하차화물</th>
                      <th>하차규격</th>
                      <th>하차중량(톤)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, idx) in parsedRows" :key="idx">
                      <td>{{ row.customer }}</td>
                      <td>{{ row.pickup }}</td>
                      <td>{{ row.pickup_cargo_type }}</td>
                      <td>{{ row.pickup_cargo_size }}</td>
                      <td>{{ row.pickup_cargo_weight_ton ?? '-' }}</td>
                      <td>{{ row.delivery }}</td>
                      <td>{{ row.cargo_type }}</td>
                      <td>{{ row.cargo_size }}</td>
                      <td>{{ row.cargo_weight_ton ?? '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="intake-actions">
              <button v-if="activeTab==='single'" type="button" class="btn btn-primary" :disabled="loading" @click="submit">{{ loading ? '접수 중…' : '오더 접수' }}</button>
              <button v-else type="button" class="btn btn-primary" :disabled="excelLoading || !parsedRows.length" @click="submitExcelBatch">{{ excelLoading ? '접수 중…' : `${parsedRows.length}건 일괄 접수` }}</button>
            </div>
            <div v-if="submitted && activeTab==='single'" class="info-banner" style="margin-top:12px">오더가 접수되었습니다.</div>
          </div>
        </div>
      </div>
      <div class="dash-widget">
        <h2>가용 차량 / 기사</h2>
        <p style="font-size:12px;color:var(--t-text-muted)">차량 {{ vehicles.length }}대 · 기사 {{ drivers.length }}명</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  gap: 8px;
}
.tab {
  padding: 6px 14px;
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.tab.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.excel-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.error-text {
  color: #dc2626;
  font-size: 13px;
  margin-bottom: 8px;
}
.preview-table-wrap {
  margin-top: 12px;
}
.preview-table-wrap .data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.preview-table-wrap .data-table th,
.preview-table-wrap .data-table td {
  border: 1px solid #e5e7eb;
  padding: 6px 8px;
  text-align: left;
}
.preview-table-wrap .data-table th {
  background: #f9fafb;
}
.text-muted {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 6px;
}
</style>
