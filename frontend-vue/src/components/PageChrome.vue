<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NAV } from '@/constants.js'

const props = defineProps({
  title: String,
  desc: String,
})

const route = useRoute()

const main = computed(() => NAV.find(g => g.id === route.meta.main))
const pageLabel = computed(() => {
  const g = main.value
  if (!g) return ''
  const p = g.pages.find(x => x.id === route.name)
  return p ? p.label : ''
})
const heading = computed(() => props.title || pageLabel.value)
</script>

<template>
  <header class="page-chrome">
    <p class="page-breadcrumb">{{ main?.label }} › <strong>{{ pageLabel }}</strong></p>
    <h1 class="page-heading">{{ heading }}</h1>
    <p v-if="desc" class="page-desc">{{ desc }}</p>
  </header>
</template>
