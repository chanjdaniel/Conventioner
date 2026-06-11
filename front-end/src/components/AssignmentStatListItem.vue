<script setup lang="ts">
import { useRouter } from 'vue-router';

const props = defineProps<{
    label: string;
    value: number | string;
    to?: string;
}>();

const router = useRouter();

function handleNavigate(): void {
    if (props.to) {
        router.push(props.to);
    }
}
</script>

<template>
    <button
        v-if="to"
        type="button"
        class="assignment-stat-list-item assignment-stat-list-item--clickable"
        @click="handleNavigate"
    >
        <span class="assignment-stat-list-label">{{ label }}</span>
        <span class="assignment-stat-list-value">{{ value }}</span>
    </button>
    <div v-else class="assignment-stat-list-item">
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

button.assignment-stat-list-item {
    width: 100%;
    border-top: none;
    border-right: none;
    border-bottom: none;
    font: inherit;
    text-align: left;
}

.assignment-stat-list-item--clickable {
    cursor: pointer;
    transition: transform 0.12s ease-in-out, box-shadow 0.12s ease-in-out, background-color 0.12s ease-in-out;
}

.assignment-stat-list-item--clickable:hover {
    transform: translateX(2px);
    background-color: var(--mm-beige);
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.10),
        0 4px 8px rgba(0, 0, 0, 0.10),
        0 10px 20px rgba(0, 0, 0, 0.10);
}

.assignment-stat-list-item--clickable:focus-visible {
    outline: 2px solid var(--mm-green);
    outline-offset: 2px;
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

.assignment-stat-list-item--clickable:hover .assignment-stat-list-value {
    background-color: white;
}
</style>
