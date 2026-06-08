/**
 * 전화번호 정규화 (한국 형식)
 */
export function normalizePhone(value) {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('82') && digits.length >= 11) {
    const local = `0${digits.slice(2)}`
    if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
    if (local.length === 11) return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`
  }
  if (digits.startsWith('02')) {
    if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
    if (digits.length === 10) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  return raw
}
