import type { SupabaseClient } from '@supabase/supabase-js';

import type { SendProductNodeConfig } from '@/lib/flows/types';

import { resolveCollectionCatalogProducts } from './collections';
import { getShopifyCatalogProduct } from './product-store';
import { sendShopifyProductCard } from './send-product-card';
import { sendShopifyProductCarousel } from './send-product-carousel';
import {
  DEFAULT_CAROUSEL_INTRO,
  DEFAULT_COLLECTION_PRODUCTS,
  MAX_SEND_PRODUCTS,
} from './send-product-constants';

function uniqueIds(values: unknown[]): string[] {
  return [
    ...new Set(values.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean)),
  ].slice(0, MAX_SEND_PRODUCTS);
}

/**
 * Variant ids for fixed and variable sources. A variable may hold one id,
 * an array, or a comma/space separated list.
 */
export function resolveStaticSendProductVariantIds(args: {
  cfg: SendProductNodeConfig;
  vars: Record<string, unknown>;
}): string[] {
  const { cfg } = args;
  if (cfg.product_source === 'variable') {
    const key = cfg.variant_id_var?.trim() || 'shopify_variant_id';
    const raw = args.vars[key];
    const ids = uniqueIds(Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/));
    if (ids.length === 0) {
      throw new Error(`Missing flow var "${key}" for send_product node`);
    }
    return ids;
  }

  const ids = uniqueIds(
    cfg.products?.length
      ? cfg.products.map((p) => p.shopify_variant_id)
      : [cfg.shopify_variant_id],
  );
  if (ids.length === 0) {
    throw new Error('send_product node has no products selected');
  }
  return ids;
}

export interface SendProductNodeResult {
  whatsapp_message_id: string;
  shopify_variant_ids: string[];
  mode: 'card' | 'carousel';
  checkout_url?: string;
}

/**
 * Sends a send_product node: one product as a single card, 2+ as a
 * carousel. Products that can't appear in a carousel (out of stock / no
 * image) are dropped; if only one usable product remains it goes out as a
 * single card.
 */
export async function sendProductNode(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  flowRunId: string;
  cfg: SendProductNodeConfig;
  vars: Record<string, unknown>;
  introText?: string;
}): Promise<SendProductNodeResult> {
  const { cfg } = args;
  let ids: string[];
  if (cfg.product_source === 'collection') {
    if (!cfg.collection_id) throw new Error('send_product node has no collection selected');
    const limit = Math.min(
      Math.max(cfg.max_products ?? DEFAULT_COLLECTION_PRODUCTS, 1),
      MAX_SEND_PRODUCTS,
    );
    const products = await resolveCollectionCatalogProducts({
      db: args.db,
      accountId: args.accountId,
      collectionId: cfg.collection_id,
      limit,
      requireImage: limit > 1,
    });
    ids = products.map((p) => String(p.shopify_variant_id));
    if (ids.length === 0) {
      throw new Error(
        `Collection "${cfg.collection_title ?? cfg.collection_id}" has no in-stock synced products`,
      );
    }
  } else {
    ids = resolveStaticSendProductVariantIds({ cfg, vars: args.vars });
  }

  if (ids.length > 1) {
    const catalog = await Promise.all(
      ids.map((id) =>
        getShopifyCatalogProduct({ db: args.db, accountId: args.accountId, shopifyVariantId: id }),
      ),
    );
    const inStock = ids.filter((_, i) => catalog[i]?.in_stock);
    const carouselReady = ids.filter((_, i) => catalog[i]?.in_stock && catalog[i]?.image_url?.trim());
    if (carouselReady.length >= 2) {
      const result = await sendShopifyProductCarousel({
        db: args.db,
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        bodyText: args.introText?.trim() || DEFAULT_CAROUSEL_INTRO,
        shopifyVariantIds: carouselReady,
        buttonLabel: cfg.button_label,
        linkTarget: cfg.link_target,
        quantity: cfg.quantity,
        flowRunId: args.flowRunId,
      });
      return {
        whatsapp_message_id: result.whatsapp_message_id,
        shopify_variant_ids: carouselReady,
        mode: 'carousel',
      };
    }
    if (inStock.length === 0) throw new Error('None of the selected products are in stock.');
    ids = inStock.slice(0, 1);
  }

  const result = await sendShopifyProductCard({
    db: args.db,
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    shopifyVariantId: ids[0],
    quantity: cfg.quantity,
    flowRunId: args.flowRunId,
    introText: args.introText,
    buttonLabel: cfg.button_label,
    linkTarget: cfg.link_target,
  });
  return {
    whatsapp_message_id: result.whatsapp_message_id,
    shopify_variant_ids: [ids[0]],
    mode: 'card',
    checkout_url: result.checkout_url,
  };
}
