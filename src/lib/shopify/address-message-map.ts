/**
 * Map Shopify address records onto Meta Address Message field shapes
 * (India / Singapore). Used to prefill `values` / `saved_addresses`
 * when a Collect-address flow node runs for a Shopify-connected brand.
 */

import type {
  AddressMessageCountry,
  AddressMessageValues,
  AddressSavedAddress,
} from '@/lib/whatsapp/address-message'
import { formatAddressValues } from '@/lib/whatsapp/address-message'
import type { ShopifyAddressFields } from './types'

function fullName(
  first?: string | null,
  last?: string | null,
): string {
  return [first, last].filter(Boolean).join(' ').trim()
}

/** Meta address forms expect a dialable phone; normalize to +digits when possible. */
function formatAddressPhone(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8) return raw.trim()
  return `+${digits}`
}

function countryCodeOf(address: ShopifyAddressFields): string | null {
  const raw = (address.country_code || address.country || '').trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  if (upper === 'IN' || upper === 'INDIA') return 'IN'
  if (upper === 'SG' || upper === 'SINGAPORE') return 'SG'
  // Two-letter ISO already
  if (upper.length === 2) return upper
  return upper
}

/**
 * True when this Shopify address is usable for the Address Message
 * country's form (Meta rejects conflicting field sets).
 */
export function shopifyAddressMatchesCountry(
  address: ShopifyAddressFields,
  country: AddressMessageCountry,
): boolean {
  const code = countryCodeOf(address)
  // Unknown country: still allow — zip mapping uses the node country.
  if (!code) return true
  return code === country
}

/**
 * Convert a Shopify address into Meta Address Message `values`.
 * Returns null when there isn't enough to show a useful saved option.
 */
export function shopifyAddressToMetaValues(
  address: ShopifyAddressFields | null | undefined,
  country: AddressMessageCountry,
  fallbacks?: { name?: string | null; phone?: string | null },
): AddressMessageValues | null {
  if (!address) return null
  if (!shopifyAddressMatchesCountry(address, country)) return null

  const name =
    address.name?.trim() ||
    fullName(address.first_name, address.last_name) ||
    fallbacks?.name?.trim() ||
    undefined

  const phone =
    formatAddressPhone(
      (typeof address.phone === 'string' && address.phone.trim()) ||
        fallbacks?.phone?.trim() ||
        undefined,
    ) || undefined

  const street = [address.address1, address.company]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(', ')

  const zip = typeof address.zip === 'string' ? address.zip.trim() : ''
  const city = typeof address.city === 'string' ? address.city.trim() : ''
  const state =
    (typeof address.province === 'string' && address.province.trim()) ||
    (typeof address.province_code === 'string' && address.province_code.trim()) ||
    ''
  const address2 =
    typeof address.address2 === 'string' ? address.address2.trim() : ''

  const values: AddressMessageValues = {}
  if (name) values.name = name
  if (phone) values.phone_number = phone
  if (street) values.address = street
  if (city) values.city = city

  if (country === 'IN') {
    if (zip) values.in_pin_code = zip.slice(0, 6)
    if (state) values.state = state
    if (address2) values.landmark_area = address2
  } else {
    if (zip) values.sg_post_code = zip.slice(0, 6)
    if (address2) values.unit_number = address2
  }

  // Need at least a street or city/pin to be worth offering as saved.
  if (!values.address && !values.city && !values.in_pin_code && !values.sg_post_code) {
    return null
  }

  return values
}

/**
 * Meta's Address Message picker becomes hard to use (and often
 * fails to scroll) when too many saved addresses are sent. Show only
 * the 3 most recent matches — current order/context first, then
 * this customer's recent Shopify order shipping addresses.
 */
export const MAX_SAVED_ADDRESSES = 3

/**
 * Build Meta `saved_addresses` entries from Shopify address records.
 * Dedupes by a stable fingerprint of the mapped values and caps the
 * list at {@link MAX_SAVED_ADDRESSES}.
 */
export function shopifyAddressesToSaved(
  addresses: ShopifyAddressFields[],
  country: AddressMessageCountry,
  fallbacks?: { name?: string | null; phone?: string | null },
  max = MAX_SAVED_ADDRESSES,
): AddressSavedAddress[] {
  const out: AddressSavedAddress[] = []
  const seen = new Set<string>()

  for (let index = 0; index < addresses.length; index += 1) {
    if (out.length >= max) break
    const addr = addresses[index]!
    const value = shopifyAddressToMetaValues(addr, country, fallbacks)
    if (!value) continue
    const fingerprint = formatAddressValues(value).toLowerCase()
    if (!fingerprint || seen.has(fingerprint)) continue
    seen.add(fingerprint)
    out.push({
      id: `shopify_${index}_${fingerprint.slice(0, 24).replace(/\W+/g, '_')}`,
      value,
    })
  }

  return out
}

/**
 * Prefill `values` for the form when we have a single best address
 * (first saved entry), or at least name/phone from the contact.
 */
export function buildAddressPrefillValues(args: {
  country: AddressMessageCountry
  saved: AddressSavedAddress[]
  name?: string | null
  phone?: string | null
}): AddressMessageValues | undefined {
  if (args.saved.length > 0) {
    return { ...args.saved[0]!.value }
  }
  const values: AddressMessageValues = {}
  if (args.name?.trim()) values.name = args.name.trim()
  if (args.phone?.trim()) values.phone_number = args.phone.trim()
  return Object.keys(values).length > 0 ? values : undefined
}
