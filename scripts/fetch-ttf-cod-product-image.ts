import { config } from 'dotenv'

config({ path: '.env.local' })

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { enrichContextProductImage } = await import('../src/lib/shopify/enrich-product-image')
  const { contextFromOrder } = await import('../src/lib/shopify/extract-context')
  const { fetchOrder } = await import('../src/lib/shopify/admin-api')
  const { decrypt } = await import('../src/lib/whatsapp/encryption')
  type ShopifyOrderPayload = import('../src/lib/shopify/types').ShopifyOrderPayload

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const db = createClient(url, key)

  const { data: ttfAccount } = await db
    .from('accounts')
    .select('id, name')
    .ilike('name', '%TTF%')
    .maybeSingle()

  if (!ttfAccount) throw new Error('TTF Clothings account not found')

  const { data: codOrder } = await db
    .from('shopify_orders')
    .select('*')
    .eq('account_id', ttfAccount.id)
    .contains('tags', ['COD'])
    .order('ordered_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!codOrder) throw new Error('No COD order found')

  const { data: shopifyConfig } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', ttfAccount.id)
    .maybeSingle()

  if (!shopifyConfig?.access_token || shopifyConfig.status !== 'connected') {
    throw new Error('Shopify not connected')
  }

  const shopDomain = shopifyConfig.shop_domain as string
  const shopName = shopDomain.replace('.myshopify.com', '')
  const accessToken = decrypt(shopifyConfig.access_token as string)

  const order = (await fetchOrder(
    shopDomain,
    accessToken,
    codOrder.shopify_order_id,
  )) as ShopifyOrderPayload

  let ctx = contextFromOrder(order, shopName)
  ctx = await enrichContextProductImage({
    context: ctx,
    shopDomain,
    encryptedAccessToken: shopifyConfig.access_token as string,
    orderId: order.id,
    lineItems: order.line_items,
  })

  const { data: flowRuns } = await db
    .from('flow_runs')
    .select('vars')
    .eq('account_id', ttfAccount.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const runProductImage = flowRuns
    ?.map((r) => (r.vars as Record<string, unknown> | null)?.product_image)
    .find((v) => typeof v === 'string' && String(v).includes('shopify')) as string | undefined

  console.log(
    JSON.stringify(
      {
        account: ttfAccount,
        order: {
          order_number: codOrder.order_number,
          shopify_order_id: codOrder.shopify_order_id,
          items: ctx.orderItems,
          tags: codOrder.tags,
          ordered_at: codOrder.ordered_at,
        },
        product_image: ctx.productImage,
        template_variable: ctx.productImage
          ? `{{ vars.product_image }} → ${ctx.productImage}`
          : null,
        stored_on_flow_run: runProductImage ?? null,
        line_items: order.line_items?.map((li) => ({
          name: li.name ?? li.title,
          product_id: li.product_id,
          image_url: li.image_url ?? li.image?.src ?? li.image?.url ?? null,
        })),
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
