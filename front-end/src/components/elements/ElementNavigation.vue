<script setup lang="ts">
import { inject } from 'vue';
import ElementNavigationItem from './ElementNavigationItem.vue';
import IconSettings from '../icons/IconSettings.vue';
import IconVendors from '../icons/IconVendors.vue';
import IconTables from '../icons/IconTables.vue';
import IconTools from '../icons/IconTools.vue';
import IconLog from '../icons/IconLog.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import IconSignOutSquare from '../icons/IconSignOutSquare.vue';
import ElementSignoutButton from './ElementSignoutButton.vue';

const user: any = inject("user");

</script>

<template>
    <div class="nav-bar" ref="nav-bar">
        <button class="close-button" @click="$emit('menuClose')">
            <IconCloseRound class="close-icon" />
        </button>

        <h2 class="user-email">{{ user?.email }} </h2>

        <div class="nav">

            <ElementNavigationItem to="vendors">
                <template #icon>
                    <IconVendors class="nav-icon" />
                </template>
                <h3>
                    <span>View </span>
                    <span class="vendors-1">Vendors</span>
                </h3>
            </ElementNavigationItem>

            <ElementNavigationItem to="vendors">
                <template #icon>
                    <IconTables class="nav-icon" />
                </template>
                <h3>
                    <span>View </span>
                    <span class="tables-1">Tables</span>
                </h3>
            </ElementNavigationItem>

            <ElementNavigationItem to="welcome">
                <template #icon>
                    <IconSettings class="nav-icon" />
                </template>
                <h3>Manage Tables</h3>
            </ElementNavigationItem>

            <ElementNavigationItem to="vendors">
                <template #icon>
                    <IconTools class="nav-icon" />
                </template>
                <h3>Discord Tools</h3>
            </ElementNavigationItem>

            <ElementNavigationItem to="vendors">
                <template #icon>
                    <IconLog class="nav-icon" />
                </template>
                <h3>View Change Log</h3>
            </ElementNavigationItem>

            <ElementSignoutButton>
                <template #icon>
                    <IconSignOutSquare class="nav-icon" />
                </template>
                <h3>Sign Out</h3>
            </ElementSignoutButton>

        </div>
    </div>
</template>

<style scoped>
.user-email {
    margin-top: 20px;
    font-size: 18px;
}

h3 {
font-family: 'Merge One';
font-style: normal;
font-size: 18px;

/* color: #ffffff; */
color: var(--mm-black);
}

.nav-bar {
    /* Auto layout */
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px;

    width: 12%;
    height: 100%;

    min-width: 250px;
    max-width: 300px;

    background: #ffffff;
    border-radius: 0px 10px 10px 0px;
}

.close-button {
    position: absolute;
    top: 0;
    right: 0;
    margin: 5px;
    padding: 0;

    height: 30px;
    aspect-ratio: 1;

    display: flex;
    align-items: center;
    justify-content: center;

    cursor: pointer;
    background-color: transparent;
    border: none;
}

.close-icon {
    aspect-ratio: 1;
    background-color: none;
}

.nav {
display: flex;
flex-direction: column;
position: relative;
top: 30px;
width: 100%;
gap: 10px;
}

.vendors-1 {
    color: var(--mm-black);
}

.tables-1 {
    color: var(--mm-black);
}

.nav-icon {
    height: 24px;
    aspect-ratio: 1;
    margin: 6px;
    color: var(--mm-black);
}


</style>