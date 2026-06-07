import { apiGet, apiPost, apiPatch, apiDelete } from '@/api/client.js'

export function getDrivers() {
  return apiGet('/drivers')
}

export function createDriver(body) {
  return apiPost('/drivers', body)
}

export function patchDriver(id, body) {
  return apiPatch(`/drivers/${id}`, body)
}

export function deleteDriver(id) {
  return apiDelete(`/drivers/${id}`)
}
