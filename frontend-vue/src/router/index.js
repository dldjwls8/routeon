import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'

const routes = [
  { path: '/', name: 'index', component: () => import('@/views/IndexView.vue'), meta: { label: '홈' } },
  { path: '/intro', redirect: '/' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { label: '로그인' } },
  { path: '/register', name: 'register', component: () => import('@/views/RegisterView.vue'), meta: { label: '회원가입' } },
  { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { main: 'dashboard', label: '대시보드' } },
  { path: '/control-live', name: 'control-live', component: () => import('@/views/ControlLiveView.vue'), meta: { main: 'control', label: '실시간 차량 관제' } },
  { path: '/order-intake', name: 'order-intake', component: () => import('@/views/OrderIntakeView.vue'), meta: { main: 'dispatch', label: '오더접수' } },
  { path: '/order-list', name: 'order-list', component: () => import('@/views/OrderListView.vue'), meta: { main: 'dispatch', label: '오더목록' } },
  { path: '/dispatch-manage', name: 'dispatch-manage', component: () => import('@/views/DispatchManageView.vue'), meta: { main: 'dispatch', label: '배차관리' } },
  { path: '/customer-list', name: 'customer-list', component: () => import('@/views/CustomerListView.vue'), meta: { main: 'customers', label: '고객 관리' } },
  { path: '/schedule-calendar', name: 'schedule-calendar', component: () => import('@/views/ScheduleCalendarView.vue'), meta: { main: 'schedule', label: '캘린더' } },
  { path: '/schedule-gantt', name: 'schedule-gantt', component: () => import('@/views/ScheduleGanttView.vue'), meta: { main: 'schedule', label: '간트' } },
  { path: '/schedule-milestones', name: 'schedule-milestones', component: () => import('@/views/ScheduleMilestonesView.vue'), meta: { main: 'schedule', label: '마일스톤' } },
  { path: '/trip-stats', name: 'trip-stats', component: () => import('@/views/TripStatsView.vue'), meta: { main: 'schedule', label: '사후 통계' } },
  { path: '/drivers', name: 'drivers', component: () => import('@/views/DriversView.vue'), meta: { main: 'basic', label: '자기사' } },
  { path: '/vehicles', name: 'vehicles', component: () => import('@/views/VehiclesView.vue'), meta: { main: 'basic', label: '차량' } },
  { path: '/staff', name: 'staff', component: () => import('@/views/StaffView.vue'), meta: { main: 'basic', label: '담당자' } },
  { path: '/profile', name: 'profile', component: () => import('@/views/ProfileView.vue'), meta: { main: 'basic', label: '기업 정보' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { label: '설정' } },
  { path: '/chat', name: 'chat', component: () => import('@/views/ChatView.vue'), meta: { label: '채팅' } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
