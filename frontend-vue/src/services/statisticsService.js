import { apiFetch } from '@/api/client.js'

export async function getTripStats() {
  try {
    const res = await apiFetch('/statistics/trips', { method: 'GET' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GET /statistics/trips failed: ${res.status}`)
    return await res.json()
  } catch (e) {
    if (e.message?.includes('404')) return null
    throw e
  }
}
