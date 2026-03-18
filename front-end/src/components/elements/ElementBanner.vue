<script setup lang="ts">
    import { useRouter } from 'vue-router';
    import IconMenu from '../icons/IconMenu.vue';

    defineProps({
        isLogin: Boolean
    })

    const router = useRouter();

    function goToDashboard() {
        router.push({ name: 'dashboard' });
    }
</script>

<template>
    <div class="banner">
        <button class="menu-button" @click="$emit('menuOpen')" v-show="!isLogin">
            <IconMenu class="menu-icon" />
        </button>
        <button class="logo-button" @click="goToDashboard" type="button">
            <img alt="Conventioner logo" class="conventioner-logo" src="@/assets/icons/conventioner-logo.svg"/>
        </button>
    </div>
</template>

<style scoped>
.banner {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    position: relative;

    /* width: 100vw;
    height: 5vh; */

    min-height: 30px;
    max-height: 100px;

    /* MMWhite */
    background: #FFFFFF;
    box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);

    /* Inside auto layout */
    flex: none;
    order: 0;
    align-self: stretch;
    flex-grow: 0;
}

.menu-button {
    /* MenuFrame */

    height: 100%;
    aspect-ratio: 1;


    /* Inside auto layout */
    flex: none;
    order: 0;
    flex-grow: 0;
    align-items: center;
    justify-content: center;

    background-color: white;
    cursor: pointer;
    transition: background-color 0.15s ease-in-out;
    border: none;
}

.menu-button:hover {
    background-color: #ececec;
    /* color: white; */
}

.menu-icon {
    aspect-ratio: 1;
}

.logo-button {
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0;
    margin-left: 8px;
    background: none;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s ease-in-out;
}

.logo-button:hover {
    opacity: 0.8;
}

.conventioner-logo {
    height: 65%;
}
</style>
