import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './stores/floorplan'
import VueKonva from 'vue-konva'

import App from './App.vue'
import router from './router'
import { PrimeVue } from '@primevue/core'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue)
app.use(VueKonva)

app.mount('#app')
