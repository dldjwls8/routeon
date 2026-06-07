import { ref } from 'vue'

/** @file src/composables/useApi.js
 *  API 호출의 loading / error 상태를 관리하는 공통 composable.
 */

export function useApi() {
  const loading = ref(false)
  const error = ref(null)

  /**
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function run(fn) {
    loading.value = true
    error.value = null
    try {
      return await fn()
    } catch (e) {
      error.value = e
      throw e
    } finally {
      loading.value = false
    }
  }

  return { loading, error, run }
}
