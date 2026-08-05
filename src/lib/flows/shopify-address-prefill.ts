/**
 * Resolve Shopify addresses to Meta Address Message prefills for a
 * Collect-address flow node.
 *
 * Sources (in order, merged + deduped):
 *   1. Structured `shipping_address_fields` already on the flow run
 *      (Shopify order/checkout trigger for this conversation).
 *   2. This contact's recent Shopify order shipping addresses (by phone)
 *      when the store is connected — never the store-wide address book.
 */

import { decrypt } from '@/lib/whatsapp/encryption'
import type {
  AddressMessageCountry,
  AddressMessageValues,
  AddressSavedAddress,
} from '@/lib/whatsapp/address-message'
import { fetchCustomerAddressesByPhone } from '@/lib/shopify/admin-api'
import {
  buildAddressPrefillValues,
  shopifyAddressesToSaved,
} from '@/lib/shopify/address-message-map'
import type { ShopifyAddressFields } from '@/lib/shopify/types'
import { supabaseAdmin } from './admin-client'

function asShopifyAddress(raw: unknown): ShopifyAddressFields | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as ShopifyAddressFields
}

export interface ResolveShopifyAddressPrefillArgs {
  accountId: string
  contactId: string
  country: AddressMessageCountry
  /** Flow run vars — may already hold shipping_address_fields. */
  vars: Record<string, unknown>
  /** When false, skip Admin API lookup (still uses vars). Default true. */
  fetchFromShopify?: boolean
}

export interface ResolveShopifyAddressPrefillResult {
  values?: AddressMessageValues
  savedAddresses?: AddressSavedAddress[]
  /** How many Shopify address records were considered (for logging). */
  sourceCount: number
}

/**
 * Build Meta `values` + `saved_addresses` for an Address Message send.
 * Never throws — Shopify outages should not block the form send.
 */
export async function resolveShopifyAddressPrefill(
  args: ResolveShopifyAddressPrefillArgs,
): Promise<ResolveShopifyAddressPrefillResult> {
  const db = supabaseAdmin()
  const fromVars: ShopifyAddressFields[] = []

  const varFields = asShopifyAddress(args.vars.shipping_address_fields)
  if (varFields) fromVars.push(varFields)

  let fromShopify: ShopifyAddressFields[] = []
  let contactName: string | null = null
  let contactPhone: string | null = null

  try {
    const { data: contact } = await db
      .from('contacts')
      .select('id, phone, name, email')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle()

    contactName = (contact as { name?: string | null } | null)?.name ?? null
    contactPhone = (contact as { phone?: string | null } | null)?.phone ?? null

    if (args.fetchFromShopify !== false && contactPhone) {
      const { data: config } = await db
        .from('shopify_config')
        .select('shop_domain, access_token, status')
        .eq('account_id', args.accountId)
        .maybeSingle()

      if (
        config &&
        (config as { status?: string }).status === 'connected' &&
        (config as { access_token?: string }).access_token &&
        (config as { shop_domain?: string }).shop_domain
      ) {
        try {
          const accessToken = decrypt(
            (config as { access_token: string }).access_token,
          )
          fromShopify = await fetchCustomerAddressesByPhone(
            (config as { shop_domain: string }).shop_domain,
            accessToken,
            contactPhone,
          )
        } catch (err) {
          console.warn(
            '[flows] Shopify address prefill lookup failed:',
            err instanceof Error ? err.message : err,
          )
        }
      }
    }
  } catch (err) {
    console.warn(
      '[flows] Shopify address prefill contact load failed:',
      err instanceof Error ? err.message : err,
    )
  }

  const merged = [...fromVars, ...fromShopify]
  const saved = shopifyAddressesToSaved(merged, args.country, {
    name: contactName,
    phone: contactPhone,
  })
  const values = buildAddressPrefillValues({
    country: args.country,
    saved,
    name: contactName,
    phone: contactPhone,
  })

  return {
    values,
    savedAddresses: saved.length > 0 ? saved : undefined,
    sourceCount: merged.length,
  }
}
