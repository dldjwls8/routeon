import { apiGet } from '@/api/client.js'

export function getUserProfile() {
  return apiGet('/users/me')
}
