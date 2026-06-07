<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'

const route = useRoute()
const isDashboardRoute = computed(() => !!route.meta.main)
</script>

<template>
  <DashboardLayout v-if="isDashboardRoute">
    <router-view />
  </DashboardLayout>
  <router-view v-else />
</template>
