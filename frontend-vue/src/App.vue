<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'

const route = useRoute()
const isDashboardRoute = computed(() => !!route.meta.main)
</script>

<template>
  <!-- 대시보드 라우트: 레이아웃 쉘은 Vue가 생성, 콘텐츠는 dashboard.js가 통제 -->
  <DashboardLayout v-if="isDashboardRoute">
    <router-view />
  </DashboardLayout>
  <!-- 비대시보드 라우트(로그인/회원가입/설정): Vue가 정상 렌더링 -->
  <router-view v-else />
</template>
