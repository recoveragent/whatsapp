import { config } from 'dotenv'

config({ path: '.env.local' })

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { fetchProductImageUrl } = await import('../src/lib/shopify/admin-api')
  const { decrypt } = await import('../src/lib/whatsapp/encryption')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const db = createClient(url, key)

  const { data: ttfAccount } = await db
    .from('accounts')
    .select('id, name')
    .ilike('name', '%TTF%')
    .maybeSingle()

  if (!ttfAccount) throw new Error('TTF account not found')

  const { data: shopifyConfig } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status, scopes, updated_at')
    .eq('account_id', ttfAccount.id)
    .maybeSingle()

  if (!shopifyConfig?.access_token) throw new Error('Shopify not connected')

  const storedScopes = Array.isArray(shopifyConfig.scopes)
    ? (shopifyConfig.scopes as string[])
    : []

  const hasReadProducts = storedScopes.some((s) =>
    String(s).includes('read_products'),
  )

  let productReadOk = false
  let productImageUrl: string | null = null
  let productReadError: string | null = null

  if (shopifyConfig.status === 'connected') {
    try {
      const accessToken = decrypt(shopifyConfig.access_token as string)
      productImageUrl = await fetchProductImageUrl(
        shopifyConfig.shop_domain as string,
        accessToken,
        9072731193563,
      )
      productReadOk = !!productImageUrl
    } catch (err) {
      productReadError = err instanceof Error ? err.message : String(err)
    }
  }

  console.log(
    JSON.stringify(
      {
        account: ttfAccount.name,
        shop_domain: shopifyConfig.shop_domain,
        connection_status: shopifyConfig.status,
        token_last_updated: shopifyConfig.updated_at,
        stored_scopes: storedScopes,
        has_read_products_on_token: hasReadProducts,
        can_read_products_now: productReadOk,
        sample_product_image_url: productImageUrl,
        error: productReadError,
        next_step: hasReadProducts
          ? productReadOk
            ? 'Product reads work — new orders should get product_image.'
            : 'Token has read_products but API still failed; check product id or app permissions.'
          : 'Reconnect Shopify in Settings so a new token is issued with read_products.',
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
