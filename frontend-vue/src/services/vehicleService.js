import { apiGet, apiDelete } from '@/api/client.js'

export function getVehicles() {
  return apiGet('/vehicles')
}

export function deleteVehicle(id) {
  return apiDelete(`/vehicles/${id}`)
}
