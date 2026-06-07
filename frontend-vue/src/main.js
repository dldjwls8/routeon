import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/dashboard.css'

const app = createApp(App)
app.use(router)

const routeMap = {
  '/dashboard': ['dashboard', 'dashboard'],
  '/control-live': ['control', 'control-live'],
  '/order-intake': ['dispatch', 'order-intake'],
  '/order-list': ['dispatch', 'order-list'],
  '/dispatch-manage': ['dispatch', 'dispatch-manage'],
  '/customer-list': ['customers', 'customer-list'],
  '/schedule-calendar': ['schedule', 'schedule-calendar'],
  '/schedule-gantt': ['schedule', 'schedule-gantt'],
  '/schedule-milestones': ['schedule', 'schedule-milestones'],
  '/trip-stats': ['schedule', 'trip-stats'],
  '/drivers': ['basic', 'drivers'],
  '/vehicles': ['basic', 'vehicles'],
  '/staff': ['basic', 'staff'],
  '/profile': ['basic', 'profile'],
}

const pathByMainPage = {}
Object.entries(routeMap).forEach(([path, [main, page]]) => {
  pathByMainPage[`${main}/${page}`] = path
})

let dashboardInitialized = false
let ignoreNextNavigation = false

// 기존 dashboard.js의 gotoPage()가 호출하면 Vue Router path로 동기화
window._onRouteOnGotoPage = (main, page) => {
  const path = pathByMainPage[`${main}/${page}`]
  if (!path) return
  const currentRoute = router.currentRoute.value
  if (currentRoute.path === path) return
  ignoreNextNavigation = true
  router.push(path).catch(() => {}).finally(() => {
    ignoreNextNavigation = false
  })
}

router.beforeEach((to, from, next) => {
  if (ignoreNextNavigation) {
    next()
    return
  }
  const mapped = routeMap[to.path]
  if (mapped) {
    const url = new URL(window.location.href)
    const [main, page] = mapped
    url.searchParams.set('main', main)
    url.searchParams.set('page', page)
    window.history.replaceState(null, '', url)
    if (!dashboardInitialized && window.RouteOnInit) {
      dashboardInitialized = true
      window.RouteOnInit()
    } else if (window.RouteOnGotoPage) {
      window.RouteOnGotoPage(main, page)
    }
  }
  next()
})

app.mount('#app')
