import { describe, expect, it } from 'vitest'
import { buildSendTimeParamsFromVariables } from './template-send-params'

describe('buildSendTimeParamsFromVariables header media', () => {
  it('keeps an http(s) media link', () => {
    expect(
      buildSendTimeParamsFromVariables(
        { header_media: 'https://cdn.example.com/a.jpg' },
        (v) => v,
      ).headerMediaUrl,
    ).toBe('https://cdn.example.com/a.jpg')
  })

  it('drops a plain-text value so the product image can fill the header', () => {
    expect(
      buildSendTimeParamsFromVariables(
        { header_media: '{{ vars.product_image }}' },
        () => 'Product image unavailable',
      ).headerMediaUrl,
    ).toBeUndefined()
  })
})
