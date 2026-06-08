import { apiGet, apiDelete, apiPatch } from '@/api/client.js'

export function getTrips() {
  return apiGet('/trips')
}

export function patchTripStatus(id, status) {
  return apiPatch(`/trips/${id}/status?status=${status}`)
}

export function reassignTrip(id, body) {
  return apiPatch(`/trips/${id}/reassign`, body)
}

export function deleteTrip(id) {
  return apiDelete(`/trips/${id}`)
}
