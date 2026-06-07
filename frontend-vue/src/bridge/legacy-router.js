/** @file src/bridge/legacy-router.js
 *  기존 dashboard.js (레거시 HTML/JS) 와 Vue Router 간 양방향 동기화 브리지.
 *  main.js 에서 setupLegacyRouter(router) 를 호출해 등록한다.
 */

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

export function setupLegacyRouter(router) {
  let dashboardInitialized = false
  let ignoreNextNavigation = false

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
}
