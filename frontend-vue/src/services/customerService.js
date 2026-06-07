import { apiGet, apiPost, apiPatch, apiDelete } from '@/api/client.js'

export function getCustomers() {
  return apiGet('/customers')
}

export function createCustomer(body) {
  return apiPost('/customers', body)
}

export function patchCustomer(id, body) {
  return apiPatch(`/customers/${id}`, body)
}

export function deleteCustomer(id) {
  return apiDelete(`/customers/${id}`)
}
