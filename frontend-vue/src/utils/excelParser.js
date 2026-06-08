/**
 * 엑셀 오더 접수 파서
 * 레거시 frontend/dashboard.js 로직을 ESM/Vue 스타일로 포팅
 * 상차/하차 화물·규격·중량 완전 분리 (방안 B)
 */

export function excelDateTimeValue(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
  }
  if (!value) return ''
  const s = String(value).trim()
  return s.length === 10 ? `${s}T00:00` : s.replace(' ', 'T').slice(0, 16)
}

export function excelBoolValue(value) {
  const s = String(value || '').trim().toLowerCase()
  return ['y', 'yes', '1', 'true', '혼재', 'o'].includes(s)
}

function normalizedExcelRow(rawRow) {
  const norm = (s) => String(s).trim().toLowerCase().replace(/[\s_\-()]/g, '')
  const index = {}
  for (const [k, v] of Object.entries(rawRow)) index[norm(k)] = v
  const pick = (...aliases) => {
    for (const a of aliases) {
      const key = norm(a)
      if (index[key] != null && String(index[key]).trim() !== '') return index[key]
    }
    return ''
  }
  return { pick }
}

export function rowsFromExcelOrder(rawRow) {
  const { pick } = normalizedExcelRow(rawRow)

  const base = {
    customer: pick('화주명', '화주', 'shippername', 'shipper'),
    contact_name: pick('담당자', 'manager', '담당자명'),
    contact: pick('연락처', 'contact', 'contactname'),
    latestAt: excelDateTimeValue(pick('희망도착', '마감일', 'deadline', 'latestat', '희망도착일시')),
    mixed_load: excelBoolValue(pick('혼재', '혼재여부', 'mixedload', '혼재화물')),
  }

  const legacyPickup = pick('상차지', '출발지', 'pickup', 'pickupaddress')
  const legacyDelivery = pick('하차지', '도착지', '주소', 'delivery', 'address')
  const legacyCargo = pick('화물종류', '화물', 'cargo', 'cargotype')
  const legacySize = pick('규격', '화물규격', '중량', '톤', '중량톤', 'tons', 'cargosize', 'cargoweightton')
  const legacyWeightRaw = pick('중량(톤)', '중량', '톤수', 'tonnage', 'weightton')
  const legacyWeightNum = legacyWeightRaw ? parseFloat(String(legacyWeightRaw).replace(/[^0-9.]/g, '')) : NaN
  const legacyRecipient = pick('수취인', '수령인', 'recipientname', 'recipient')

  const pickups = []
  const deliveries = []
  for (let i = 1; i <= 5; i++) {
    const address = pick(`상차지${i}`, `상차${i}`, `pickup${i}`, `pickupaddress${i}`)
    if (address) {
      const weightRaw = pick(`상차중량(톤)${i}`, `상차중량${i}`, `pickupweightton${i}`, `pickupweight${i}`)
      pickups.push({
        pickup: address,
        cargo_type: pick(`상차화물${i}`, `상차화물종류${i}`, `pickupcargo${i}`, `pickupcargotype${i}`),
        cargo_size: pick(`상차규격${i}`, `상차중량${i}`, `pickupsize${i}`, `pickupcargosize${i}`),
        cargo_weight_ton: weightRaw ? parseFloat(String(weightRaw).replace(/[^0-9.]/g, '')) : NaN,
      })
    }
    const delivery = pick(`하차지${i}`, `하차${i}`, `delivery${i}`, `address${i}`, `deliveryaddress${i}`)
    if (delivery) {
      const weightRaw = pick(`하차중량(톤)${i}`, `하차중량${i}`, `deliveryweightton${i}`, `deliveryweight${i}`)
      deliveries.push({
        delivery,
        recipient: pick(`하차수취인${i}`, `수취인${i}`, `recipient${i}`, `recipientname${i}`),
        cargo_type: pick(`하차화물${i}`, `하차화물종류${i}`, `deliverycargo${i}`, `deliverycargotype${i}`),
        cargo_size: pick(`하차규격${i}`, `하차중량${i}`, `deliverysize${i}`, `deliverycargosize${i}`),
        cargo_weight_ton: weightRaw ? parseFloat(String(weightRaw).replace(/[^0-9.]/g, '')) : NaN,
      })
    }
  }

  if (!pickups.length && legacyPickup) {
    pickups.push({
      pickup: legacyPickup,
      cargo_type: legacyCargo,
      cargo_size: legacySize,
      cargo_weight_ton: isNaN(legacyWeightNum) ? null : legacyWeightNum,
    })
  }
  if (!deliveries.length && legacyDelivery) {
    deliveries.push({
      delivery: legacyDelivery,
      recipient: legacyRecipient,
      cargo_type: legacyCargo,
      cargo_size: legacySize,
      cargo_weight_ton: isNaN(legacyWeightNum) ? null : legacyWeightNum,
    })
  }
  if (!pickups.length && !deliveries.length) return []

  const count = Math.max(pickups.length, deliveries.length)
  return Array.from({ length: count }, (_, i) => {
    const pu = pickups[Math.min(i, Math.max(0, pickups.length - 1))] || {}
    const dl = deliveries[Math.min(i, Math.max(0, deliveries.length - 1))] || {}
    return {
      ...base,
      pickup: pu.pickup || '',
      pickup_cargo_type: pu.cargo_type || '',
      pickup_cargo_size: pu.cargo_size || '',
      pickup_cargo_weight_ton: isNaN(pu.cargo_weight_ton) ? null : pu.cargo_weight_ton,
      delivery: dl.delivery || '',
      recipient: dl.recipient || '',
      cargo_type: dl.cargo_type || pu.cargo_type || legacyCargo || '',
      cargo_size: dl.cargo_size || pu.cargo_size || legacySize || '',
      cargo_weight_ton: isNaN(dl.cargo_weight_ton)
        ? (isNaN(pu.cargo_weight_ton) ? null : pu.cargo_weight_ton)
        : dl.cargo_weight_ton,
    }
  })
}

export function generateIntakeTemplate() {
  const today = new Date()
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const headers = [
    '화주명', '담당자', '연락처',
    '상차지1', '상차화물1', '상차규격1', '상차중량(톤)1',
    '상차지2', '상차화물2', '상차규격2', '상차중량(톤)2',
    '상차지3', '상차화물3', '상차규격3', '상차중량(톤)3',
    '하차지1', '하차수취인1', '하차화물1', '하차규격1', '하차중량(톤)1',
    '하차지2', '하차수취인2', '하차화물2', '하차규격2', '하차중량(톤)2',
    '하차지3', '하차수취인3', '하차화물3', '하차규격3', '하차중량(톤)3',
    '희망도착일시', '혼재여부',
  ]
  const rows = [
    [
      '예시화주', '김담당', '010-1234-5678',
      '부산광역시 해운대구 센텀중앙로 90', '식품', '5톤', '5.0',
      '', '', '', '',
      '', '', '', '',
      '부산광역시 사하구 감천로 203', '김수신', '식품', '2톤', '2.0',
      '', '', '', '', '',
      '', '', '', '', '',
      `${todayStr} 14:00`, 'N',
    ],
  ]
  return { headers, rows, filename: `routeon_order_intake_template_${todayStr}.xlsx` }
}
