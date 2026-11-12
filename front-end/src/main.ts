import './assets/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';
import { routerSettled } from '@/utils/routerReady';
import { installSessionEnded } from '@/utils/sessionEnded';
import { installMarketChanged } from '@/stores/market';
import { PAGE_FAILED, watchPageFailed } from '@/utils/pageFailed';

const app = createApp(App);

app.use(createPinia());
// Before the router is installed, which starts the first navigation: a page whose code could not
// be fetched says so, the first one included (E38/F11/S01).
app.provide(PAGE_FAILED, watchPageFailed(router));
app.use(router);

// A 401 mid-work takes the organizer to sign in again, and back to the page (E38/F11/S01).
installSessionEnded(router);
// A write refused because the market changed under it re-reads the open market, so every screen
// shows it as it now stands (ADR 0024).
installMarketChanged();

// Defer mount until the first navigation settles. The session probe in
// App.vue and every public-page check both read route metadata, so neither
// can run until the router knows where it is.
routerSettled(router).then(() => {
  app.mount('#app');
});
