<script setup lang="ts">
defineProps<{
    label: string;
    value: number | string;
}>();
</script>

<template>
    <div class="assignment-stat-list-item">
        <span class="assignment-stat-list-label">{{ label }}</span>
        <span class="assignment-stat-list-value">{{ value }}</span>
    </div>
</template>

<style scoped>
.assignment-stat-list-item {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background-color: white;
    border-radius: 6px;
    border-left: 4px solid var(--mm-green);
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.07),
        0 2px 4px rgba(0, 0, 0, 0.07),
        0 6px 14px rgba(0, 0, 0, 0.08);
}

.assignment-stat-list-label {
    font-family: 'Outfit Regular';
    font-size: 15px;
    color: var(--mm-black);
}

.assignment-stat-list-value {
    font-family: 'Merge One';
    font-size: 16px;
    font-weight: bold;
    color: var(--mm-green);
    background-color: var(--mm-beige);
    padding: 3px 11px;
    border-radius: 20px;
    min-width: 44px;
    text-align: center;
}
</style>
