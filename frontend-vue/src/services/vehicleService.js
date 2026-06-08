import { apiGet, apiPatch, apiDelete } from '@/api/client.js'

export function getVehicles() {
  return apiGet('/vehicles')
}

export function patchVehicle(id, body) {
  return apiPatch(`/vehicles/${id}`, body)
}

export function deleteVehicle(id) {
  return apiDelete(`/vehicles/${id}`)
}
