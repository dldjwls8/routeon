import { apiGet } from '@/api/client.js'

export function getStaff() {
  return apiGet('/staff')
}
