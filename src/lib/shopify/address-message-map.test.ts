import { describe, expect, it } from 'vitest'
import {
  buildAddressPrefillValues,
  shopifyAddressMatchesCountry,
  shopifyAddressToMetaValues,
  shopifyAddressesToSaved,
} from './address-message-map'

describe('shopifyAddressToMetaValues', () => {
  it('maps an India Shopify address onto Meta IN fields', () => {
    const values = shopifyAddressToMetaValues(
      {
        first_name: 'Devi',
        last_name: 'Salim',
        address1: 'Link Road, Malad (West)',
        address2: 'Behind Evershine Mall',
        city: 'Mumbai',
        province: 'Maharashtra',
        zip: '400064',
        country_code: 'IN',
        phone: '+913850881995',
      },
      'IN',
    )
    expect(values).toMatchObject({
      name: 'Devi Salim',
      phone_number: '+913850881995',
      address: 'Link Road, Malad (West)',
      landmark_area: 'Behind Evershine Mall',
      city: 'Mumbai',
      state: 'Maharashtra',
      in_pin_code: '400064',
    })
    expect(values).not.toHaveProperty('sg_post_code')
  })

  it('maps a Singapore Shopify address onto Meta SG fields', () => {
    const values = shopifyAddressToMetaValues(
      {
        name: 'Alex Tan',
        address1: '9 Straits View',
        address2: '12-34',
        city: 'Singapore',
        zip: '018937',
        country_code: 'SG',
        phone: '+6591234567',
      },
      'SG',
    )
    expect(values).toMatchObject({
      name: 'Alex Tan',
      address: '9 Straits View',
      unit_number: '12-34',
      city: 'Singapore',
      sg_post_code: '018937',
      phone_number: '+6591234567',
    })
    expect(values).not.toHaveProperty('in_pin_code')
  })

  it('rejects country mismatches', () => {
    expect(
      shopifyAddressMatchesCountry({ country_code: 'US', city: 'NYC' }, 'IN'),
    ).toBe(false)
    expect(
      shopifyAddressToMetaValues(
        { country_code: 'US', address1: '5th Ave', city: 'NYC', zip: '10001' },
        'IN',
      ),
    ).toBeNull()
  })
})

describe('shopifyAddressesToSaved', () => {
  it('dedupes identical mapped addresses', () => {
    const addr = {
      name: 'Pat',
      address1: 'Janpath Rd',
      city: 'Delhi',
      zip: '110001',
      country_code: 'IN',
    }
    const saved = shopifyAddressesToSaved([addr, { ...addr }], 'IN')
    expect(saved).toHaveLength(1)
    expect(saved[0]!.id).toMatch(/^shopify_/)
  })
})

describe('buildAddressPrefillValues', () => {
  it('prefers the first saved address', () => {
    expect(
      buildAddressPrefillValues({
        country: 'IN',
        saved: [
          { id: 'a', value: { name: 'A', city: 'Delhi' } },
          { id: 'b', value: { name: 'B', city: 'Mumbai' } },
        ],
      }),
    ).toEqual({ name: 'A', city: 'Delhi' })
  })

  it('falls back to contact name/phone', () => {
    expect(
      buildAddressPrefillValues({
        country: 'SG',
        saved: [],
        name: 'Sam',
        phone: '+6599999999',
      }),
    ).toEqual({ name: 'Sam', phone_number: '+6599999999' })
  })
})
