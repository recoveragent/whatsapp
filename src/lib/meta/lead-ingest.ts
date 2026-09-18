import type { SupabaseClient } from '@supabase/supabase-js';

import { createOrMoveDealForContact } from '@/lib/deals/create-or-move-deal';
import { recordDuplicateLeadEntryIfExists } from '@/lib/leads/duplicate-count';
import { enrollContact, patchContactLead } from '@/lib/leads/enroll';
import type { CadenceStep, LeadLanguage } from '@/lib/leads/types';
import { mergeMetaAttribution } from '@/lib/meta/attribution';
import { emitLeadQualityEvent } from '@/lib/meta/lead-quality-events';
import { ensureShopifyContact } from '@/lib/shopify/ensure-contact';
import { decrypt } from '@/lib/whatsapp/encryption';

import {
  fetchMetaLead,
  normalizeMetaLead,
  type MetaLeadgenChange,
} from './lead-ads';

interface MetaLeadSource {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  page_id: string;
  form_id: string | null;
  access_token: string;
  cadence_id: string | null;
  pipeline_id: string;
  stage_id: string;
  default_language: LeadLanguage;
}

async function findSource(
  db: SupabaseClient,
  change: MetaLeadgenChange
): Promise<MetaLeadSource | null> {
  const { data, error } = await db
    .from('meta_lead_sources')
    .select('*')
    .eq('page_id', change.pageId)
    .eq('active', true);
  if (error) throw new Error(error.message);
  const sources = (data as MetaLeadSource[] | null) ?? [];
  return (
    sources.find((source) => source.form_id === change.formId) ??
    sources.find((source) => source.form_id == null) ??
    null
  );
}

async function cadenceSteps(
  db: SupabaseClient,
  cadenceId: string
): Promise<CadenceStep[]> {
  const { data, error } = await db
    .from('cadence_steps')
    .select('*')
    .eq('cadence_id', cadenceId)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as CadenceStep[] | null) ?? [];
}

export async function ingestMetaLead(
  db: SupabaseClient,
  change: MetaLeadgenChange,
  webhookPayload: unknown
): Promise<{ duplicate: boolean; contactId?: string; dealId?: string }> {
  const { data: previous } = await db
    .from('meta_lead_deliveries')
    .select('status, attempts, updated_at')
    .eq('leadgen_id', change.leadgenId)
    .maybeSingle();
  const processingIsFresh =
    previous?.status === 'processing' &&
    typeof previous.updated_at === 'string' &&
    Date.now() - new Date(previous.updated_at).getTime() < 5 * 60_000;
  if (previous?.status === 'processed' || processingIsFresh) {
    return { duplicate: true };
  }

  const source = await findSource(db, change);
  if (!source) {
    throw new Error(
      `No active Meta lead source for Page ${change.pageId} and form ${change.formId ?? '*'}`
    );
  }

  const { error: claimError } = await db.from('meta_lead_deliveries').upsert(
    {
      leadgen_id: change.leadgenId,
      source_id: source.id,
      account_id: source.account_id,
      page_id: change.pageId,
      form_id: change.formId,
      status: 'processing',
      error: null,
      webhook_payload: webhookPayload,
      attempts:
        typeof previous?.attempts === 'number' ? previous.attempts + 1 : 1,
    },
    { onConflict: 'leadgen_id' }
  );
  if (claimError) throw new Error(claimError.message);

  try {
    const lead = await fetchMetaLead(
      change.leadgenId,
      decrypt(source.access_token)
    );
    const normalized = normalizeMetaLead(lead);
    if (!normalized.phone)
      throw new Error('Instant Form response has no phone number');

    await recordDuplicateLeadEntryIfExists(
      db,
      source.account_id,
      normalized.phone
    );
    const contact = await ensureShopifyContact(
      db,
      source.account_id,
      source.user_id,
      normalized.phone,
      normalized.name || normalized.phone
    );
    if (!contact) throw new Error('Lead phone number is invalid');

    const { data: existing } = await db
      .from('contacts')
      .select('email, lead_language, lead_status, referral')
      .eq('id', contact.id)
      .maybeSingle();

    await patchContactLead(db, {
      accountId: source.account_id,
      contactId: contact.id,
      patch: {
        ...(!existing?.email && normalized.email
          ? { email: normalized.email }
          : {}),
        ...(!existing?.lead_language
          ? { lead_language: source.default_language }
          : {}),
        referral: mergeMetaAttribution(
          (existing?.referral as Record<string, unknown> | null) ?? null,
          {
            attribution_source: 'instant_form',
            meta_lead_id: change.leadgenId,
            form_id: change.formId ?? lead.form_id,
            ad_id: change.adId ?? lead.ad_id,
          }
        ),
      },
    });

    const deal = await createOrMoveDealForContact(db, {
      accountId: source.account_id,
      userId: source.user_id,
      contactId: contact.id,
      pipelineId: source.pipeline_id,
      stageId: source.stage_id,
      title: normalized.name || contact.phone,
    });

    if (source.cadence_id) {
      const steps = await cadenceSteps(db, source.cadence_id);
      await enrollContact({
        db,
        accountId: source.account_id,
        userId: source.user_id,
        contactId: contact.id,
        cadenceId: source.cadence_id,
        leadSourceId: null,
        steps,
        currentLeadStatus: existing?.lead_status as string | null,
      });
    }

    const { error: finishError } = await db
      .from('meta_lead_deliveries')
      .update({
        status: 'processed',
        contact_id: contact.id,
        deal_id: deal.dealId,
        lead_payload: lead,
        processed_at: new Date().toISOString(),
        error: null,
      })
      .eq('leadgen_id', change.leadgenId);
    if (finishError) throw new Error(finishError.message);

    void emitLeadQualityEvent({
      db,
      accountId: source.account_id,
      contactId: contact.id,
      signal: 'instant_form_enrolled',
    }).catch((error) =>
      console.error('[meta-leads] CAPI event failed:', error)
    );

    return { duplicate: false, contactId: contact.id, dealId: deal.dealId };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown Meta lead ingestion error';
    await db
      .from('meta_lead_deliveries')
      .update({ status: 'failed', error: message.slice(0, 1000) })
      .eq('leadgen_id', change.leadgenId);
    throw error;
  }
}
