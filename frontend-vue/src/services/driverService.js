import { apiGet, apiPost, apiPatch, apiDelete } from '@/api/client.js'

export function getDrivers() {
  return apiGet('/users?role=driver')
}

export function createDriver(body) {
  return apiPost('/users', body)
}

export function patchDriver(id, body) {
  return apiPatch(`/users/${id}`, body)
}

export function deleteDriver(id) {
  return apiDelete(`/users/${id}`)
}
