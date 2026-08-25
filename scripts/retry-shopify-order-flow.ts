/**
 * Manually replay Shopify order-placed flow dispatch for one order.
 *
 * Usage:
 *   npx tsx scripts/retry-shopify-order-flow.ts --contact 0585b233-... --order 7393219346651
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined
}

async function main() {
  const contactId = arg('contact')
  const shopifyOrderId = arg('order')
  if (!contactId || !shopifyOrderId) {
    console.error(
      'Usage: npx tsx scripts/retry-shopify-order-flow.ts --contact <uuid> --order <shopify_order_id>',
    )
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const { supabaseAdmin } = await import('../src/lib/automations/admin-client')
  const { fetchOrder } = await import('../src/lib/shopify/admin-api')
  const { contextFromOrder } = await import('../src/lib/shopify/extract-context')
  const { enrichOrderContextImage } = await import('../src/lib/shopify/enrich-product-image')
  const { syncShopifyOrder } = await import('../src/lib/shopify/sync-order')
  const { dispatchShopifyFlows } = await import('../src/lib/flows/shopify-dispatch')
  const { decrypt } = await import('../src/lib/whatsapp/encryption')

  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone, name, account_id')
    .eq('id', contactId)
    .maybeSingle()

  if (contactErr || !contact) {
    console.error('Contact not found:', contactErr?.message ?? contactId)
    process.exit(1)
  }

  const accountId = contact.account_id as string

  const { data: config, error: configErr } = await db
    .from('shopify_config')
    .select('user_id, shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle()

  if (configErr || !config || config.status !== 'connected' || !config.access_token) {
    console.error('Shopify not connected for account', accountId)
    process.exit(1)
  }

  const shopDomain = config.shop_domain as string
  const accessToken = decrypt(config.access_token as string)
  const order = await fetchOrder(shopDomain, accessToken, shopifyOrderId)

  if (!order?.id) {
    console.error('Order not found in Shopify:', shopifyOrderId)
    process.exit(1)
  }

  const shopName = shopDomain.replace('.myshopify.com', '')
  await syncShopifyOrder(db, accountId, order, shopName)

  let eventContext = contextFromOrder(order, shopName)
  eventContext = await enrichOrderContextImage({
    context: eventContext,
    order,
    shopDomain,
    encryptedAccessToken: config.access_token as string,
  })

  console.info('Retrying flow dispatch', {
    contact: `${contact.name} (${contact.phone})`,
    order: eventContext.orderNumber,
    payment_status: eventContext.financialStatus,
  })

  const outcome = await dispatchShopifyFlows({
    db,
    accountId,
    ownerUserId: config.user_id as string,
    triggerType: 'shopify_order_placed',
    context: eventContext,
  })

  console.log(JSON.stringify(outcome, null, 2))

  if (!outcome.ok && outcome.dispatch?.started.length === 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
