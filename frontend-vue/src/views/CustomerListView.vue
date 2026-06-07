<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { apiGet, apiDelete, apiPost, apiPatch } from '@/api/client.js'
import { PAGE_SIZE } from '@/constants.js'

const customers = ref([])
const loading = ref(true)
const customerListFilter = ref('전체')
const customerSearch = ref('')
const customerPage = ref(1)
const selectedCustomerId = ref(null)
const customerEditMode = ref(false)

const filterChips = ['전체', '정규', '임시(당일)']

const allRows = computed(() => {
  let rows = customers.value
  if (customerListFilter.value === '정규') rows = rows.filter(c => !c.is_temporary)
  if (customerListFilter.value === '임시(당일)') rows = rows.filter(c => c.is_temporary)
  const q = customerSearch.value.trim()
  if (q) {
    rows = rows.filter(c =>
      (c.name||'').includes(q) || (c.phone||'').includes(q) || (c.address||'').includes(q)
    )
  }
  return rows
})
const rows = computed(() => allRows.value.slice((customerPage.value - 1) * PAGE_SIZE, customerPage.value * PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(allRows.value.length / PAGE_SIZE)))

const selected = computed(() => customers.value.find(c => c.id === selectedCustomerId.value))

async function load() {
  loading.value = true
  try {
    const data = await apiGet('/customers')
    customers.value = Array.isArray(data) ? data : (data.items || [])
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function selectCustomer(id) {
  selectedCustomerId.value = id
  customerEditMode.value = false
}

async function deleteCustomer() {
  if (!selected.value || !confirm('정말 삭제하시겠습니까?')) return
  try {
    await apiDelete(`/customers/${selected.value.id}`)
    customers.value = customers.value.filter(c => c.id !== selected.value.id)
    selectedCustomerId.value = null
  } catch (e) { alert('삭제 실패') }
}

const showModal = ref(false)
const modalEdit = ref(false)
const modalForm = ref({ name:'', phone:'', address:'', lat:null, lon:null })

function openModal(c=null) {
  modalEdit.value = !!c
  if (c) {
    modalForm.value = { name:c.name||'', phone:c.phone||'', address:c.address||'', lat:c.lat, lon:c.lon }
  } else {
    modalForm.value = { name:'', phone:'', address:'', lat:null, lon:null }
  }
  showModal.value = true
}

async function saveModal() {
  const body = { ...modalForm.value }
  try {
    let data
    if (modalEdit.value) {
      data = await apiPatch(`/customers/${selected.value.id}`, body)
      const idx = customers.value.findIndex(c => c.id === selected.value.id)
      if (idx >= 0) Object.assign(customers.value[idx], data)
    } else {
      data = await apiPost('/customers', body)
      customers.value.push(data)
    }
    showModal.value = false
  } catch (e) { alert('저장 실패') }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="거래처 · 좌측 목록 · 우측 상세 · 당일 임시 화주" />
    <div class="master-detail-split">
      <div class="master-detail-list">
        <div class="card card-fill">
          <div class="card-hd">
            <h2>고객 목록</h2>
            <div class="toolbar">
              <div class="chips">
                <button v-for="f in filterChips" :key="f" type="button" class="chip" :class="{ active: customerListFilter===f }" @click="customerListFilter=f; customerPage=1; selectedCustomerId=null">{{ f }}</button>
              </div>
              <input v-model="customerSearch" type="search" class="search" placeholder="고객명·연락처·주소" @input="customerPage=1">
              <button type="button" class="btn btn-primary" @click="openModal()">+ 추가</button>
            </div>
            <p class="cust-filter-hint">임시(당일): 접수 시 등록한 당일 화주만 · 일자 종료 후 목록에서 숨김</p>
          </div>
          <div class="card-bd master-list-body">
            <div class="table-scroll">
              <table>
                <thead><tr><th>고객명</th><th>연락처</th><th>주소</th><th>유형</th></tr></thead>
                <tbody>
                  <tr v-if="!rows.length"><td colspan="4" class="empty-hint" style="padding:16px">표시할 고객이 없습니다.</td></tr>
                  <tr v-for="c in rows" :key="c.id" :class="{ selected: selectedCustomerId===c.id }" @click="selectCustomer(c.id)">
                    <td><strong>{{ c.name }}</strong> <span v-if="c.is_temporary" class="badge badge-temp">임시</span></td>
                    <td>{{ c.phone || '—' }}</td>
                    <td>{{ c.address || '—' }}</td>
                    <td>{{ c.is_temporary ? '임시' : '정규' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="pagination">
              <button :disabled="customerPage<=1" @click="customerPage--">‹</button>
              <button v-for="p in totalPages" :key="p" :class="{ active: customerPage===p }" @click="customerPage=p">{{ p }}</button>
              <button :disabled="customerPage>=totalPages" @click="customerPage++">›</button>
              <span>{{ allRows.length }}건</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="selected" class="master-detail-pane">
        <div class="inline-detail">
          <div class="inline-detail-hd">
            <h2>{{ selected.name }} <span v-if="selected.is_temporary" class="badge badge-temp">임시</span></h2>
            <button type="button" class="detail-close-btn" @click="selectedCustomerId=null">×</button>
          </div>
          <div class="inline-detail-bd">
            <div class="form-grid" style="max-width:100%">
              <label>고객명</label><span>{{ selected.name }}</span>
              <label>연락처</label><span>{{ selected.phone || '—' }}</span>
              <label>주소</label><span>{{ selected.address || '—' }}</span>
              <label>유형</label><span>{{ selected.is_temporary ? '임시' : '정규' }}</span>
              <label>위도</label><span class="coord">{{ selected.lat ?? '—' }}</span>
              <label>경도</label><span class="coord">{{ selected.lon ?? '—' }}</span>
            </div>
          </div>
          <div class="inline-detail-footer">
            <div class="inline-detail-secondary">
              <button type="button" class="btn btn-sm btn-danger-outline" @click="deleteCustomer">고객 삭제</button>
            </div>
            <div><button type="button" class="btn btn-primary" @click="openModal(selected)">수정</button></div>
          </div>
        </div>
      </div>
      <div v-else class="master-detail-pane">
        <div class="detail-empty-hint">고객을 선택하면 상세 정보가 표시됩니다.</div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="overlay open" @click.self="showModal=false">
      <div class="modal" role="dialog">
        <div class="modal-hd"><h3>{{ modalEdit ? '고객 수정' : '고객 추가' }}</h3><button class="modal-close" @click="showModal=false">×</button></div>
        <div class="modal-bd">
          <div class="form-grid" style="max-width:100%">
            <label>고객명 *</label><input v-model="modalForm.name">
            <label>연락처 *</label><input v-model="modalForm.phone">
            <label>주소 *</label><input v-model="modalForm.address">
          </div>
        </div>
        <div class="modal-ft">
          <button type="button" class="btn" @click="showModal=false">취소</button>
          <button type="button" class="btn btn-primary" @click="saveModal">저장</button>
        </div>
      </div>
    </div>
  </div>
</template>
