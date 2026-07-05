<script setup lang="ts">
import axios from 'axios';
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();
const route = useRoute();

const token = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const errorMessage = ref('');
const successMessage = ref('');
const showPassword = ref(false);
const isLoading = ref(false);

onMounted(() => {
    const tokenParam = route.query.token as string;
    if (!tokenParam) {
        errorMessage.value = 'No reset token provided';
        router.push('/reset-password-request');
        return;
    }
    token.value = tokenParam;
});

const submitReset = async () => {
    errorMessage.value = '';
    successMessage.value = '';
    
    if (!newPassword.value || !confirmPassword.value) {
        errorMessage.value = 'Password and confirmation are required';
        return;
    }

    if (newPassword.value !== confirmPassword.value) {
        errorMessage.value = 'Passwords do not match';
        return;
    }

    if (newPassword.value.length < 8) {
        errorMessage.value = 'Password must be at least 8 characters long';
        return;
    }

    isLoading.value = true;

    try {
        const response = await axios.post(
            `${hostname}/reset-password`,
            {
                token: token.value,
                new_password: newPassword.value,
            },
            {
                withCredentials: true,
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.status === 200) {
            successMessage.value = response.data.msg || 'Password reset successfully!';
            setTimeout(() => {
                router.push('/login');
            }, 2000);
        }
    } catch (_e: unknown) {
        const error = _e as { response?: { data?: { msg?: string; message?: string }; status?: number }; request?: unknown; message?: string };
        if (error.response) {
            errorMessage.value = error.response.data?.msg || 'Failed to reset password';
        } else if (error.request) {
            errorMessage.value = 'Unable to connect to server. Please try again.';
        } else {
            errorMessage.value = 'An error occurred. Please try again.';
        }
    } finally {
        isLoading.value = false;
    }
};
</script>

<template>
    <div class="container">
        <div class="reset-window">
            <h1>Reset Password</h1>
            <p class="description">Enter your new password below.</p>
            
            <form @submit.prevent="submitReset" class="reset-form" data-testid="password-reset-form">
                <div class="input-group">
                    <input
                        :type="showPassword ? 'text' : 'password'"
                        v-model="newPassword"
                        placeholder="New Password (min 8 characters)"
                        class="password-input"
                        required
                        :disabled="isLoading"
                        data-testid="password-reset-new-password-input"
                    />
                    <button type="button" class="show-button" @click="showPassword = !showPassword" data-testid="password-reset-toggle-password">
                        {{ showPassword ? 'Hide' : 'Show' }}
                    </button>
                </div>
                
                <div class="input-group">
                    <input
                        :type="showPassword ? 'text' : 'password'"
                        v-model="confirmPassword"
                        placeholder="Confirm password"
                        class="password-input"
                        required
                        :disabled="isLoading"
                        data-testid="password-reset-confirm-password-input"
                    />
                </div>
                
                <h3 class="error-message" v-show="errorMessage" data-testid="password-reset-error-message">{{ errorMessage }}</h3>
                <h3 class="success-message" v-show="successMessage" data-testid="password-reset-success-message">{{ successMessage }}</h3>
                
                <button type="submit" class="submit-button" :disabled="isLoading" data-testid="password-reset-submit-button">
                    {{ isLoading ? 'Resetting...' : 'Reset Password' }}
                </button>
                
                <div class="form-links">
                    <a href="#" @click.prevent="router.push('/login')" class="link" data-testid="password-reset-back-link">Back to Login</a>
                </div>
            </form>
        </div>
    </div>
</template>

<style scoped>
.container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.reset-window {
    width: 600px;
    min-height: 500px;
    background-color: white;
    border-radius: 10px;
    box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
    padding: 60px;
}

.description {
    color: #666;
    font-size: 16px;
    margin-bottom: 30px;
    text-align: center;
}

.reset-form {
    display: flex;
    flex-direction: column;
    padding-top: 20px;
}

.input-group {
    height: 60px;
    padding-left: 10px;
    margin-top: 30px;
    border-radius: 8px;
    border: 3px solid rgba(0, 0, 0, .4);
    font-size: 20px;
    display: flex;
    flex-direction: row;
    background-color: transparent;
}

.input-group:focus-within {
    border-color: blue;
}

.input-group:has(input:disabled) {
    opacity: 0.6;
    background-color: #f5f5f5;
}

.password-input {
    width: auto;
    border: none;
    font-size: 20px;
    flex-grow: 1;
    outline: none;
}

.show-button {
    border: none;
    background-color: transparent;
    width: fit-content;
    padding-right: 20px;
    color: grey;
    font-size: 14px;
    cursor: pointer;
    outline: none;
}

.error-message {
    color: red;
    text-align: right;
    font-size: 14px;
    margin-top: 10px;
    margin-bottom: 0;
}

.success-message {
    color: green;
    text-align: center;
    font-size: 14px;
    margin-top: 10px;
    margin-bottom: 0;
}

.submit-button {
    height: 60px;
    border-radius: 30px;
    margin-top: 40px;
    background-color: var(--mm-green, #4CAF50);
    font-family: 'Outfit Regular';
    color: white;
    font-size: 20px;
    border: none;
    cursor: pointer;
}

.submit-button:hover:not(:disabled) {
    opacity: 0.9;
}

.submit-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.form-links {
    margin-top: 20px;
    text-align: center;
}

.link {
    color: #2196F3;
    text-decoration: none;
    font-size: 14px;
}

.link:hover {
    text-decoration: underline;
}
</style>
