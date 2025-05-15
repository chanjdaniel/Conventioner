<script setup lang="ts">
import { onMounted, reactive, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';

import { type SetupObject } from '@/assets/types/datatypes';

const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();



onMounted(() => {

});

const handleBack = () => {
    router.push("/market-setup");
}
const handleDone = () => {
    router.push("");
}

</script>

<template>
    <div class="generate-assignment-view">
        <div class="generate-assignment-window">
            <div class="generate-assignment-container">
                <div class="generate-assignment-header">
                    <h1>Generate Assignment</h1>
                </div>
                <div class="generate-assignment-body">
                    
                </div>
            </div>
            <div style="width: 100%; display: flex; flex-direction: row; justify-content: space-between;">
                <div>
                    <button class="done-button" @click="handleBack">Back</button>
                </div>
                <div>
                    <button class="done-button" @click="handleDone">Done</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.generate-assignment-view {
    width: 100%;
    min-width: 1000px;
    flex: 1;

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.generate-assignment-window {
    width: 80%;
    height: 80%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.generate-assignment-container {
    align-self: stretch;
    flex: 1;
    background-color: white;
    box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
}

.generate-assignment-header {
    align-self: stretch;
    height: 50px;
    background-color: var(--mm-black);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
}

.generate-assignment-body {
    align-self: stretch;
    flex-grow: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    padding: 30px;
    min-height: 0;
    flex: 1;
}

h1 {
    font-family: 'Outfit Regular';
    text-align: center;
    font-size: 30px;
    color: white;
}

h2 {
    font-family: 'Merge One';
    text-align: left;
    font-size: 26px;
    color: white;
}

.done-button {
    margin-top: 15px;
    width: 100px;
    height: 35px;

    background: var(--mm-green);
    border-radius: 5px;
    border: none;

    font-family: 'Merge One';
    font-style: normal;
    font-weight: 400;
    font-size: 20px;
    line-height: 15px;
    text-align: center;

    color: #FFFFFF;
}
</style>