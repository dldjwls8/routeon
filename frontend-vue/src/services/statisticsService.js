import { apiGet } from '@/api/client.js'

export function getTripStats() {
  return apiGet('/statistics/trips')
}
