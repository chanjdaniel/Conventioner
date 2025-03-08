<script setup lang="ts"></script>

<template>
    <div class="setting-container">
        <div class="setting-header"><slot name="setting-title"></slot></div>
        <div class="setting-body"><slot name="setting-content"></slot></div>
    </div>
</template>

<style scoped>
    .setting-container {
        width: 100%;
        height: 100%;

        display: flex;
        flex-direction: column;
        
        border-radius: 10px;
        background-color: white;
        box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
    }

    .setting-header {
        height: 50px;
        background-color: var(--mm-black);
        border-top-left-radius: 10px;
        border-top-right-radius: 10px;
        display: flex;
        flex-direction: row;
        align-items: center;
        padding: 15px;
    }

    .setting-body {
        flex-grow: 1;
        background-color: white;
        border-bottom-left-radius: 10px;
        border-bottom-right-radius: 10px;
        padding-top: 15px;
        padding-left: 20px;
        padding-right: 20px;
        padding-bottom: 20px;
    }

    ::v-deep(.row-container) {
        margin-left: 8px;
        margin-right: 8px;
        width: calc(100% - 8px);

        text-align: center;
        font-size: 12px;

        border-radius: 8px;
        background-color: white;
        box-shadow: 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    }
</style>