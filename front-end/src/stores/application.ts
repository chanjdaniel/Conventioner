import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  requestLoginCode,
  verifyLoginCode,
  verifyErrorFrom,
  requestErrorFrom,
} from '@/utils/applicantApi'

export const useApplicationStore = defineStore('application', () => {
  const marketId = ref<string | null>(null)
  const marketSlug = ref<string | null>(null)
  const applicantEmail = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  function isAuthenticatedFor(slug: string): boolean {
    return marketId.value !== null && marketSlug.value === slug
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
      return true
    } catch (err: unknown) {
      error.value = verifyErrorFrom(err)
      return false
    } finally {
      loading.value = false
    }
  }

  function clearSession(): void {
    marketId.value = null
    marketSlug.value = null
    applicantEmail.value = null
    error.value = null
  }

  function logout(): void {
    clearSession()
  }

  return {
    marketId,
    marketSlug,
    applicantEmail,
    loading,
    error,
    isAuthenticatedFor,
    requestCode,
    verifyCode,
    clearSession,
    logout,
  }
})
