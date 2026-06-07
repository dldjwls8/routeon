import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { setupLegacyRouter } from '@/bridge/legacy-router.js'
import './assets/dashboard.css'

const app = createApp(App)
app.use(router)

setupLegacyRouter(router)

app.mount('#app')
