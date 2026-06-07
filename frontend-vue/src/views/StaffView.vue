<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { apiGet } from '@/api/client.js'
import { PAGE_SIZE } from '@/constants.js'

const staff = ref([])
const page = ref(1)

const rows = computed(() => staff.value.slice((page.value-1)*PAGE_SIZE, page.value*PAGE_SIZE))
const totalPages = computed(() => Math.max(1, Math.ceil(staff.value.length/PAGE_SIZE)))

async function load() {
  try {
    const data = await apiGet('/staff')
    staff.value = Array.isArray(data) ? data : (data.items || [])
  } catch (e) { console.error(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="담당자 관리" />
    <div class="card">
      <div class="card-hd"><h2>담당자 목록</h2></div>
      <div class="card-bd">
        <div class="table-scroll">
          <table>
            <thead><tr><th>이름</th><th>이메일</th><th>역할</th></tr></thead>
            <tbody>
              <tr v-if="!rows.length"><td colspan="3" class="empty-hint">담당자가 없습니다.</td></tr>
              <tr v-for="s in rows" :key="s.id"><td>{{ s.name }}</td><td>{{ s.email || '—' }}</td><td>{{ s.role || '—' }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <button :disabled="page<=1" @click="page--">‹</button>
          <button v-for="p in totalPages" :key="p" :class="{ active: page===p }" @click="page=p">{{ p }}</button>
          <button :disabled="page>=totalPages" @click="page++">›</button>
        </div>
      </div>
    </div>
  </div>
</template>
