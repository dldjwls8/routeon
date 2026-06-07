<script setup>
import { ref, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getUserProfile } from '@/services/userService.js'

const profile = ref({})

async function load() {
  try {
    profile.value = await getUserProfile()
  } catch (e) { console.error(e) }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="기업 정보" />
    <div class="card">
      <div class="card-hd"><h2>기업 정보</h2></div>
      <div class="card-bd">
        <div class="form-grid" style="max-width:100%">
          <label>회사명</label><span>{{ profile.company_name || '—' }}</span>
          <label>담당자</label><span>{{ profile.name || '—' }}</span>
          <label>이메일</label><span>{{ profile.email || '—' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
