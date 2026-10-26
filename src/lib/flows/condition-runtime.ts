import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  fetchOrder,
  fetchConditionOrderCount,
  fetchProductCollectionMembership,
} from '@/lib/shopify/admin-api';
import {
  conditionCollectionIds,
  shopifyConditionData,
  resolveShopifyConditionValue,
} from '@/lib/shopify/condition-data';
import {
  compareCondition,
  conditionPath,
  isShopifySubject,
  SHOPIFY_CONDITION_FIELDS,
} from './conditions';
import type {
  ConditionPredicate,
  ConditionNodeConfig,
  FlowRunRow,
} from './types';

export interface ConditionTrace {
  subject: string;
  field: string;
  source: string;
  result: boolean;
  missing?: boolean;
}

/** A scope is shared by all rules in one condition/switch, so fresh reads stay consistent. */
export function createConditionEvaluator(db: SupabaseClient, run: FlowRunRow) {
  let connection: Promise<{ shop_domain: string; token: string }> | undefined;
  const fresh = new Map<string, Promise<Record<string, unknown>>>();
  const counts = new Map<string, Promise<number>>();
  const memberships = new Map<string, Promise<Map<string, Set<string>>>>();
  const traces: ConditionTrace[] = [];
  const credentials = () =>
    (connection ??= (async () => {
      const { data, error } = await db
        .from('shopify_config')
        .select('shop_domain, access_token, status')
        .eq('account_id', run.account_id)
        .maybeSingle();
      if (error || !data || data.status !== 'connected')
        throw new Error('Shopify is unavailable for latest-state conditions');
      return {
        shop_domain: data.shop_domain as string,
        token: decrypt(data.access_token as string),
      };
    })());

  async function shopifyData(
    cfg: ConditionPredicate
  ): Promise<Record<string, unknown>> {
    const kind = cfg.subject === 'shopify_checkout' ? 'checkout' : 'order';
    if (cfg.data_source !== 'latest') {
      const data = run.vars.shopify_condition_data;
      if (
        !data ||
        typeof data !== 'object' ||
        (data as Record<string, unknown>).resource_type !== kind
      )
        throw new Error(
          `No ${kind} snapshot is available; select latest state or start a new run`
        );
      return data as Record<string, unknown>;
    }
    if (kind === 'checkout')
      throw new Error(
        'Latest-state checks require a Shopify order; checkout conditions use the event snapshot'
      );
    const id =
      kind === 'order' ? run.vars.shopify_order_id : run.vars.checkout_id;
    if (!id || !/^\d+$/.test(String(id)))
      throw new Error(`No triggering Shopify ${kind} ID is available`);
    const key = `${kind}:${id}`;
    if (!fresh.has(key))
      fresh.set(
        key,
        (async () => {
          const config = await credentials();
          const resource = await fetchOrder(
            config.shop_domain,
            config.token,
            String(id)
          );
          if (!resource)
            throw new Error(`Triggering Shopify ${kind} could not be loaded`);
          return shopifyConditionData(resource, kind);
        })()
      );
    return fresh.get(key)!;
  }

  async function evaluate(cfg: ConditionPredicate): Promise<boolean> {
    let value: unknown;
    let type;
    let source: string = cfg.data_source ?? 'snapshot';
    if (isShopifySubject(cfg.subject)) {
      const data = await shopifyData(cfg);
      type = SHOPIFY_CONDITION_FIELDS.find(
        (f) => f.key === cfg.subject_key
      )?.type;
      if (
        [
          'customer_order_count',
          'previous_order_count',
          'is_first_order',
          'is_repeat_customer',
        ].includes(cfg.subject_key)
      ) {
        source = 'latest_customer_history';
        const customerId = data.customer_id;
        if (!customerId)
          throw new Error(
            'No Shopify customer ID is available for customer history'
          );
        const previous = cfg.subject_key !== 'customer_order_count';
        const created = Date.parse(String(data.created_at ?? ''));
        if (previous && !Number.isFinite(created))
          throw new Error(
            'Order creation time is unavailable for customer history'
          );
        // Count orders strictly before the triggering order. Never use the contact\'s latest order.
        const before = previous
          ? new Date(created - 1).toISOString()
          : undefined;
        const key = `${customerId}:${before ?? 'all'}`;
        if (!counts.has(key))
          counts.set(
            key,
            (async () => {
              const config = await credentials();
              return fetchConditionOrderCount(
                config.shop_domain,
                config.token,
                String(customerId),
                before
              );
            })()
          );
        const count = await counts.get(key)!;
        value =
          cfg.subject_key === 'is_first_order'
            ? count === 0
            : cfg.subject_key === 'is_repeat_customer'
              ? count > 0
              : count;
      } else {
        const collectionIds = conditionCollectionIds(cfg);
        let collections: Map<string, Set<string>> | undefined;
        if (collectionIds.length) {
          source = 'latest_collections';
          const productIds = Array.isArray(data.product_ids)
            ? data.product_ids.map(String)
            : [];
          const key = `${productIds.join(',')}|${collectionIds.join(',')}`;
          if (!memberships.has(key))
            memberships.set(
              key,
              (async () => {
                const config = await credentials();
                return fetchProductCollectionMembership(
                  config.shop_domain,
                  config.token,
                  productIds,
                  collectionIds
                );
              })()
            );
          collections = await memberships.get(key)!;
        }
        value = resolveShopifyConditionValue(
          data,
          cfg,
          Date.now(),
          collections
        );
      }
    } else if (cfg.subject === 'var' || cfg.subject === 'shopify_payment') {
      value = conditionPath(
        run.vars,
        cfg.subject === 'shopify_payment' ? 'payment_status' : cfg.subject_key
      );
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).formatted === 'string'
      )
        value = (value as Record<string, unknown>).formatted;
      // Existing variable predicates used comma-joined arrays for these operators.
      if (
        Array.isArray(value) &&
        ['equals', 'not_equals', 'contains'].includes(cfg.operator)
      )
        value = String(value);
    } else if (cfg.subject === 'tag') {
      const { count, error } = await db
        .from('contact_tags')
        .select('contact_id', { count: 'exact', head: true })
        .eq('contact_id', run.contact_id!)
        .eq('tag_id', cfg.subject_key);
      if (error) throw new Error('Contact tag lookup failed');
      value = (count ?? 0) > 0 ? cfg.subject_key : undefined;
    } else {
      if (!['name', 'email', 'phone', 'company'].includes(cfg.subject_key))
        throw new Error('Unsupported contact field');
      const { data, error } = await db
        .from('contacts')
        .select(cfg.subject_key)
        .eq('account_id', run.account_id)
        .eq('id', run.contact_id!)
        .maybeSingle();
      if (error) throw new Error('Contact field lookup failed');
      const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
      value = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    }
    const missing = value == null;
    // A missing Shopify value must not satisfy negative comparisons.
    const result =
      isShopifySubject(cfg.subject) &&
      missing &&
      !['present', 'absent'].includes(cfg.operator)
        ? false
        : compareCondition({
            operator: cfg.operator,
            subjectValue: value,
            configValue: cfg.value,
            valueTo: cfg.value_to,
            type,
          });
    traces.push({
      subject: cfg.subject,
      field: cfg.subject_key,
      source,
      result,
      ...(missing ? { missing: true } : {}),
    });
    return result;
  }
  async function group(
    cfg: Pick<ConditionNodeConfig, 'rules' | 'match'> & ConditionPredicate
  ): Promise<boolean> {
    if (!cfg.rules) return evaluate(cfg);
    if (!cfg.rules.length || cfg.rules.length > 20)
      throw new Error('A condition group needs 1–20 rules');
    for (const rule of cfg.rules) {
      const result = await evaluate(rule);
      if (cfg.match === 'any' && result) return true;
      if (cfg.match !== 'any' && !result) return false;
    }
    return cfg.match !== 'any';
  }
  return { group, traces };
}
