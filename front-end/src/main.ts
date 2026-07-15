import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './stores/floorplan'
import './stores/application'
import VueKonva from 'vue-konva'

import App from './App.vue'
import router from './router'
import { PrimeVue } from '@primevue/core'
import { routerSettled } from '@/utils/routerReady'
import { installApplicantSessionExpiry } from '@/utils/applicantSessionExpiry'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue)
app.use(VueKonva)

installApplicantSessionExpiry(router)

// Defer mount until the first navigation settles. The session probe in
// App.vue and every public-page check both read route metadata, so neither
// can run until the router knows where it is.
routerSettled(router).then(() => {
  app.mount('#app')
})
