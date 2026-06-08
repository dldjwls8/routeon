import { apiGet, apiPost, apiPatch, apiDelete } from '@/api/client.js'

export function getDeliveries() {
  return apiGet('/deliveries')
}

export function createDelivery(body) {
  return apiPost('/deliveries', body)
}

export function createDeliveriesBatch(body) {
  return apiPost('/deliveries/batch', body)
}

export function patchDelivery(id, body) {
  return apiPatch(`/deliveries/${id}`, body)
}

export function deleteDelivery(id) {
  return apiDelete(`/deliveries/${id}`)
}
