import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  requestLoginCode,
  verifyLoginCode,
  verifyErrorFrom,
  requestErrorFrom,
  fetchApplicantApplication,
  saveApplicantApplication,
} from '@/utils/applicantApi'
import type { Application } from '@/assets/types/datatypes'

export const useApplicationStore = defineStore('application', () => {
  const marketId = ref<string | null>(null)
  const marketSlug = ref<string | null>(null)
  const applicantEmail = ref<string | null>(null)
  const token = ref<string | null>(null)
  const application = ref<Application | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  function isAuthenticatedFor(slug: string): boolean {
    return token.value !== null && marketSlug.value === slug
  }

  async function requestCode(slug: string, email: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await requestLoginCode(slug, email)
    } catch (err: unknown) {
      error.value = requestErrorFrom(err)
    } finally {
      loading.value = false
    }
  }

  async function verifyCode(slug: string, email: string, code: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const result = await verifyLoginCode(slug, email, code)
      marketId.value = result.marketId
      marketSlug.value = slug
      applicantEmail.value = result.applicantEmail
      if (result.token) {
        token.value = result.token
      }
      return true
    } catch (err: unknown) {
      error.value = verifyErrorFrom(err)
      return false
    } finally {
      loading.value = false
    }
  }

  async function fetchApplication(): Promise<Application | null> {
    if (!token.value || !marketSlug.value) return null
    loading.value = true
    error.value = null
    try {
      const app = await fetchApplicantApplication(marketSlug.value, token.value)
      application.value = app
      return app
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        clearSession()
        error.value = 'Your session has expired. Please sign in again.'
      } else {
        error.value = requestErrorFrom(err)
      }
      return null
    } finally {
      loading.value = false
    }
  }

  async function saveApplication(formData: Record<string, unknown>): Promise<Application | null> {
    if (!token.value || !marketSlug.value) return null
    loading.value = true
    error.value = null
    try {
      const app = await saveApplicantApplication(marketSlug.value, token.value, formData)
      application.value = app
      return app
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        clearSession()
        error.value = 'Your session has expired. Please sign in again.'
      } else {
        error.value = requestErrorFrom(err)
      }
      return null
    } finally {
      loading.value = false
    }
  }

  function clearSession(): void {
    marketId.value = null
    marketSlug.value = null
    applicantEmail.value = null
    token.value = null
    application.value = null
    error.value = null
  }

  function logout(): void {
    clearSession()
  }

  return {
    marketId,
    marketSlug,
    applicantEmail,
    token,
    application,
    loading,
    error,
    isAuthenticatedFor,
    requestCode,
    verifyCode,
    fetchApplication,
    saveApplication,
    clearSession,
    logout,
  }
})
