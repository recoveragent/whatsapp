// ============================================================
// Broadcast audience queries, shared by the send hook and the two
// wizard steps that show an estimated reach.
//
// Every read here goes through fetchAllPages / fetchAllInChunks:
// a plain `.select()` is truncated at the project's max-rows (1 000
// by default) with no error, so a 1 220-contact tag silently became a
// 1 000-contact broadcast, and the reach shown in the confirm dialog
// was wrong by the same amount.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AudienceConfig,
  CustomFieldFilter,
} from '@/hooks/use-broadcast-sending';
import { fetchAllInChunks, fetchAllPages } from '@/lib/supabase/fetch-all';
import { resolveWooCommerceSegmentContactIds } from '@/lib/woocommerce/resolve-segment-audience';
import type { Contact } from '@/types';

/** Distinct contact ids carrying ANY of `tagIds`. */
export async function fetchTagContactIds(
  supabase: SupabaseClient,
  tagIds: string[],
): Promise<Set<string>> {
  if (tagIds.length === 0) return new Set();
  const rows = await fetchAllInChunks<{ contact_id: string }>(
    tagIds,
    (chunk, from, to) =>
      supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', chunk)
        .order('id')
        .range(from, to),
  );
  return new Set(rows.map((r) => r.contact_id));
}

/** Distinct contact ids matching a custom-field filter. */
export async function fetchCustomFieldContactIds(
  supabase: SupabaseClient,
  filter: CustomFieldFilter,
): Promise<Set<string>> {
  const { fieldId, operator, value } = filter;
  const rows = await fetchAllPages<{ contact_id: string }>((from, to) => {
    // Build the WHERE clause for the operator. "contains" uses ilike
    // with wildcards so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);
    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else query = query.ilike('value', `%${value}%`);
    return query.order('id').range(from, to);
  });
  return new Set(rows.map((r) => r.contact_id));
}

/** Every contact on the account (RLS scopes the table). */
export async function fetchAllContacts(
  supabase: SupabaseClient,
): Promise<Contact[]> {
  return fetchAllPages<Contact>((from, to) =>
    supabase.from('contacts').select('*').order('id').range(from, to),
  );
}

/** Full contact rows for a list of ids, in chunks. */
export async function fetchContactsByIds(
  supabase: SupabaseClient,
  ids: Iterable<string>,
): Promise<Contact[]> {
  return fetchAllInChunks<Contact>([...ids], (chunk, from, to) =>
    supabase
      .from('contacts')
      .select('*')
      .in('id', chunk)
      .order('id')
      .range(from, to),
  );
}

/**
 * How many contacts a (possibly half-configured) audience reaches,
 * after exclude tags. `null` when the audience isn't complete yet.
 */
export async function estimateAudienceCount(
  supabase: SupabaseClient,
  audience: AudienceConfig,
): Promise<number | null> {
  let baseIds: Set<string> | null = null; // null means "all contacts"

  if (audience.type === 'all') {
    // Handled below — full-table count adjusted by excludes.
  } else if (audience.type === 'tags' && audience.tagIds?.length) {
    baseIds = await fetchTagContactIds(supabase, audience.tagIds);
  } else if (
    audience.type === 'custom_field' &&
    audience.customField?.fieldId &&
    audience.customField.value
  ) {
    baseIds = await fetchCustomFieldContactIds(supabase, audience.customField);
  } else if (audience.type === 'csv' && audience.csvContacts?.length) {
    return audience.csvContacts.length;
  } else if (audience.type === 'woocommerce' && audience.woocommerceSegment) {
    baseIds = new Set(
      await resolveWooCommerceSegmentContactIds(
        supabase,
        audience.woocommerceSegment,
      ),
    );
  } else {
    return null;
  }

  const excludeSet = audience.excludeTagIds?.length
    ? await fetchTagContactIds(supabase, audience.excludeTagIds)
    : null;

  if (baseIds) {
    let n = 0;
    for (const id of baseIds) if (!excludeSet?.has(id)) n++;
    return n;
  }

  const { count, error } = await supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Failed to count contacts: ${error.message}`);
  return Math.max(0, (count ?? 0) - (excludeSet?.size ?? 0));
}
