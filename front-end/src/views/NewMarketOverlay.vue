<script setup lang="ts">
import ElementFileDrop from '@/components/elements/ElementFileDrop.vue';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes.ts'
import { api } from '@/utils/api';

defineProps<{
    newOpen: boolean;
}>();

const router = useRouter();
const uploadedFiles = ref([]);
const uploadedSourceData = ref([]);
const next = ref(false);
const marketName = ref("");
const errorMessage = ref("");

const handleFileUploaded = (files: any) => {
    uploadedFiles.value = files;
    next.value = true;
};

const handleSourceDataUploaded = (sourceData: any) => {
    uploadedSourceData.value = sourceData;
};

const handleSubmit = async () => {
    errorMessage.value = ""; // Clear previous error
    
    if (!marketName.value.trim()) {
        errorMessage.value = "Market name is required";
        return;
    }

    try {
        const userEmail = JSON.parse(localStorage.getItem("user") || "null");
        let newMarket: Market = {
            name: marketName.value,
            owner: userEmail,
            creationDate: new Date().toISOString(),
            editors: [userEmail],
            viewers: [],
            setupObject: null,
            modificationList: [],
            assignmentObject: {
                vendorAssignments: [],
                assignmentDate: "",
                totalVendorsAssigned: 0,
                totalTablesAssigned: 0,
                assignmentStatistics: null,
            },
        }
        
        const formData = new FormData();
        if (uploadedSourceData.value.length > 0) {
            formData.append('file', uploadedSourceData.value[0]);
        }

        await api.post(`/source-data/${marketName.value}`, formData);
        
        await api.post('/markets', newMarket, {
            headers: {
                'X-Owner-Email': userEmail
            }
        });

        localStorage.removeItem("upload");
        localStorage.setItem("upload", JSON.stringify(uploadedFiles.value));

        localStorage.removeItem("market");
        localStorage.setItem("market", JSON.stringify(newMarket));

        router.push('/market-setup');
    } catch (error: any) {
        if (error.response?.status === 400 && error.response?.data?.error) {
            const errorText = error.response.data.error.toLowerCase();
            if (errorText.includes('already exists') || errorText.includes('market already')) {
                errorMessage.value = "A market with this name already exists";
            } else {
                errorMessage.value = error.response.data.error;
            }
        } else {
            errorMessage.value = "An error occurred. Please try again.";
        }
    }
}
</script>

<template>
    <div class="container" :style="{ visibility: newOpen ? 'visible' : 'hidden' }">
        <div class="background" @click="$emit('newClose')" :style="{ opacity: newOpen ? '100%' : '0%' }">
        </div>
        <template v-if="!next">
            <ElementFileDrop :isOpen="newOpen" @file-uploaded="handleFileUploaded" @source-data-uploaded="handleSourceDataUploaded"></ElementFileDrop>
        </template>
        <template v-else>
            <div class="window">
                <h2>
                    Enter market name
                </h2>
                <div class="input-wrapper">
                    <div style="width: 100%; height: 30px; display: grid; grid-template-columns: 1fr 3fr 1fr;">
                        <div></div>
                        <div class="text-input-container">
                            <input type="text" v-model="marketName" @keydown.enter="handleSubmit" @input="errorMessage = ''"
                                style="all: unset; font-size: 14px; width: 100%; text-align: center;" />
                        </div>
                        <div style="padding-left: 10px">
                            <button @click="handleSubmit"
                                style="all: unset; height: 100%; width: 100%; cursor: pointer; opacity: 75%;">Submit</button>
                        </div>
                    </div>
                    <p v-show="errorMessage" class="error-message">{{ errorMessage }}</p>
                </div>
            </div>
        </template>>
    </div>
</template>

<style scoped>
h3 {
    display: inline;
}

.container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
}

.background {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0%;
    transition: opacity 0.15s ease-in-out, visibility 0.15s ease-in-out;
    z-index: 0;
}

.window {
    width: 25%;
    min-height: 140px;
    padding: 25px;
    gap: 10px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: white;
    border-radius: 8px;
    z-index: 1;
}

.input-wrapper {
    width: 100%;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.text-input-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    border-radius: 8px;
}

.error-message {
    position: absolute;
    top: 35px;
    left: 50%;
    transform: translateX(-50%);
    color: #d32f2f;
    font-size: 13px;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
}
</style>
