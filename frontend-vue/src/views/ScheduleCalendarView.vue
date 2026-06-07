<script setup>
import { ref, computed, onMounted } from 'vue'
import PageChrome from '@/components/PageChrome.vue'
import { apiGet } from '@/api/client.js'

const year = ref(new Date().getFullYear())
const month = ref(new Date().getMonth() + 1)
const deliveries = ref([])
const trips = ref([])

async function load() {
  try {
    const d = await apiGet('/deliveries')
    deliveries.value = Array.isArray(d) ? d : (d.items || [])
  } catch (e) {}
}

const daysInMonth = computed(() => new Date(year.value, month.value, 0).getDate())
const firstDay = computed(() => new Date(year.value, month.value - 1, 1).getDay())

function itemsForDay(day) {
  const ymd = `${year.value}-${String(month.value).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  return deliveries.value.filter(o => o.created_at && o.created_at.startsWith(ymd))
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <PageChrome desc="캘린더" />
    <div class="cal-wrap">
      <div class="cal-hd">
        <div />
        <div class="cal-month-nav">
          <button class="btn cal-nav-btn" @click="month--; if(month<1){month=12;year--}">‹</button>
          <h3>{{ year }}.{{ String(month).padStart(2,'0') }}</h3>
          <button class="btn cal-nav-btn" @click="month++; if(month>12){month=1;year++}">›</button>
        </div>
        <div />
      </div>
      <div class="cal-grid">
        <div v-for="d in ['일','월','화','수','목','금','토']" :key="d" class="cal-dow">{{ d }}</div>
        <div v-for="i in firstDay" :key="'empty'+i" class="cal-cell empty" />
        <div v-for="day in daysInMonth" :key="day" class="cal-cell" :class="{ 'has-order': itemsForDay(day).length }">
          <div class="cal-day-num">{{ day }}</div>
          <div class="cal-dots">
            <span v-for="(o,idx) in itemsForDay(day).slice(0,5)" :key="idx" class="cal-dot order" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
