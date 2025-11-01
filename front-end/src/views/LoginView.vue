<script setup lang="ts">
import axios from 'axios';
import { ref, inject } from "vue";
import { useRouter } from 'vue-router';

const hostname = import.meta.env.VITE_FLASK_HOST;

const router = useRouter();

const email = ref("");
const password = ref("");
const errorMessage = ref("");
const showPassword = ref(false);

const setUser: any = inject("setUser");

const submitLogin = async () => {
    errorMessage.value = ""; // Clear previous error
    
    try {
        const response = await axios.post(
            `${hostname}/login`,
            {
                email: email.value,
                password: password.value,
            },
            {
                withCredentials: true,
                headers: {
                "Content-Type": "application/json",
                },
            }
        );

        if (response.status === 200) {
            const user_email = response.data.user_data.email;
            localStorage.setItem("user", JSON.stringify(user_email));
            setUser(user_email);
            router.push("/init");
        }
    } catch (error: any) {
        // Handle axios errors (including 401 responses)
        if (error.response) {
            // Server responded with error status
            errorMessage.value = error.response.data?.message || "Invalid credentials";
        } else if (error.request) {
            // Request was made but no response received
            errorMessage.value = "Unable to connect to server. Please try again.";
        } else {
            // Something else happened
            errorMessage.value = "An error occurred. Please try again.";
        }
    }
};

</script>

<template>
    <div class="container">
        <div class="login-window">
            <h1>Sign in</h1>
            <form id="login-form" class="login-form" @submit.prevent="submitLogin">
                <div class="login-input">
                    <input id="email" type="text" v-model="email" placeholder="Email" class="email-input" required />
                </div>
                 <div class="login-input">
                    <input
                    id="password"
                    :type="showPassword ? 'text' : 'password'"
                    v-model="password"
                    placeholder="Password"
                    class="password-input"
                    required />
                    <button type="button" id="toggle-password" class="show-button" @click="showPassword = !showPassword">{{ showPassword ? "Hide" : "Show" }}</button>
                 </div>
                 <h3 id="incorrect-warning" v-show="errorMessage">Incorrect password</h3>
                <button type="submit" class="submit-button">Login</button>
            </form>
        </div>
    </div>
</template>

<style scoped>

    #incorrect-warning {
        color: red;
        text-align: right;
    }

    .container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .login-window {
        width: 600px;
        height: 750px;

        background-color: white;
        border-radius: 10px;
        box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);

        padding: 60px;
    }

    .login-form {
        display: flex;
        flex-direction: column;
        padding-top: 20px;
    }

    .login-input {
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

    .login-input:focus-within {
        border-color: blue;
    }

    .show-button {
        border: none;
        background-color: transparent;
        width: fit-content;
        padding-right: 20px;
        color: grey;

        font-size: 14px;
    }

    .email-input {
        width: auto;
        border: none;
        font-size: 20px;
        flex-grow: 1;
        outline: none;
    }

    .password-input {
        width: auto;
        border: none;
        font-size: 20px;
        flex-grow: 1;
        outline: none;
    }

    .submit-button {
        height: 60px;

        border-radius: 30px;
        margin-top: 40px;

        background-color: var(--mm-green);
        font-family: 'Outfit Regular';
        color: white;
        font-size: 20px;
        border: none;
    }
</style>