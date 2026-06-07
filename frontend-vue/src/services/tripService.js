import { apiGet, apiDelete, apiPatch } from '@/api/client.js'

export function getTrips() {
  return apiGet('/trips')
}

export function patchTripStatus(id, status) {
  return apiPatch(`/trips/${id}/status?status=${status}`)
}

export function deleteTrip(id) {
  return apiDelete(`/trips/${id}`)
}
