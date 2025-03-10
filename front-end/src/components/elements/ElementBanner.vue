<script setup lang="ts">
    import IconMenu from '../icons/IconMenu.vue';

    defineProps({
        isLogin: Boolean
    })
</script>

<template>
    <div class="banner">
        <button class="menu-button" @click="$emit('menuOpen')" v-show="!isLogin">
            <IconMenu class="menu-icon" />
        </button>
        <img alt="MM logo" class="mm-logo" src="@/assets/icons/mm-logo.png"/>
    </div>
</template>

<style scoped>
.banner {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
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
    position: absolute;
    left: 0px;

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

.mm-logo {
    height: 65%;
    aspect-ratio: 244 / 34;
}
</style>
