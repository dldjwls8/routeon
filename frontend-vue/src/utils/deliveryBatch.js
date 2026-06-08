import { normalizePhone } from '@/utils/phone.js'

export function toDeliveryBatchPayload(rows) {
  return rows.map((r) => ({
    address: r.delivery || '주소 미입력',
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    deadline: r.latestAt ? r.latestAt.replace('T', ' ').slice(0, 16) : null,
    recipient_name: r.recipient || null,
    cargo_type: r.cargo_type || null,
    cargo_size: r.cargo_size || null,
    cargo_weight_ton: r.cargo_weight_ton ?? null,
    pickup_address: r.pickup || null,
    pickup_lat: r.pickup_lat ?? null,
    pickup_lon: r.pickup_lon ?? null,
    pickup_cargo_type: r.pickup_cargo_type || null,
    pickup_cargo_size: r.pickup_cargo_size || null,
    pickup_cargo_weight_ton: r.pickup_cargo_weight_ton ?? null,
    shipper_name: r.customer || null,
    contact_name: r.contact_name || null,
    contact_phone: normalizePhone(r.contact) || null,
    shipper_phone: normalizePhone(r.shipper_phone || r.contact) || null,
    mixed_load: !!r.mixed_load,
  }))
}
