<script setup>
import { ref, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { getTripStats } from '@/services/statisticsService.js'

const stats = ref(null)
const loading = ref(true)

async function load() {
  try {
    stats.value = await getTripStats()
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="운행 사후 통계" />
    <div class="stat-grid">
      <div v-if="loading" class="empty-hint">통계를 불러오는 중…</div>
      <div v-else class="stat-card">
        <div class="num">{{ stats?.total_trips ?? 0 }}</div>
        <div class="lbl">총 운행</div>
      </div>
      <div v-if="!loading" class="stat-card">
        <div class="num">{{ Math.round((stats?.total_distance_m ?? 0)/1000).toLocaleString() }}km</div>
        <div class="lbl">총 거리</div>
      </div>
      <div v-if="!loading" class="stat-card">
        <div class="num">{{ stats?.completion_rate ? (stats.completion_rate*100).toFixed(1) : 0 }}%</div>
        <div class="lbl">완료율</div>
      </div>
      <div v-if="!loading" class="stat-card">
        <div class="num">{{ stats?.avg_distance_m ? Math.round(stats.avg_distance_m/1000) : 0 }}km</div>
        <div class="lbl">평균 거리</div>
      </div>
    </div>
  </div>
</template>
