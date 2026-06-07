<script setup>
import { ref, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getCustomers } from '@/services/customerService.js'
import { getVehicles } from '@/services/vehicleService.js'
import { getDrivers } from '@/services/driverService.js'
import { createDelivery } from '@/services/deliveryService.js'

const customers = ref([])
const vehicles = ref([])
const drivers = ref([])
const loading = ref(false)
const submitted = ref(false)

const form = ref({
  shipper_name: '',
  pickup_address: '',
  address: '',
  cargo_type: '',
  cargo_size: '',
  recipient_name: '',
  contact_phone: '',
  deadline: '',
  mixed_load: false,
})

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
  } catch (e) { alert('접수 실패') }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="신규 오더 접수" />
    <div class="intake-layout-wrap">
      <div class="intake-main">
        <div class="card">
          <div class="card-hd"><h2>오더 접수</h2></div>
          <div class="card-bd">
            <div class="form-grid" style="max-width:100%">
              <label>화주</label><input v-model="form.shipper_name" placeholder="화주명">
              <label>상차지</label><input v-model="form.pickup_address" placeholder="상차지 주소">
              <label>하차지 *</label><input v-model="form.address" placeholder="하차지 주소">
              <label>화물</label><input v-model="form.cargo_type" placeholder="화물 종류">
              <label>화물 크기</label><input v-model="form.cargo_size" placeholder="예: 5톤">
              <label>수령인</label><input v-model="form.recipient_name" placeholder="수령인">
              <label>연락처</label><input v-model="form.contact_phone" placeholder="연락처">
              <label>희망 도착</label><input v-model="form.deadline" placeholder="YYYY-MM-DD HH:MM">
              <label>혼적</label>
              <label class="radio-label"><input type="checkbox" v-model="form.mixed_load"> 혼적 허용</label>
            </div>
            <div class="intake-actions">
              <button type="button" class="btn btn-primary" :disabled="loading" @click="submit">{{ loading ? '접수 중…' : '오더 접수' }}</button>
            </div>
            <div v-if="submitted" class="info-banner" style="margin-top:12px">오더가 접수되었습니다.</div>
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
