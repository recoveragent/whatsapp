import crypto from 'crypto';

import { META_API_VERSION } from '@/lib/whatsapp/meta-api';

const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface MetaLeadgenChange {
  leadgenId: string;
  pageId: string;
  formId: string | null;
  adId: string | null;
  createdTime: number | null;
}

export interface MetaLeadPayload {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: Array<{ name?: string; values?: unknown[] }>;
}

export interface NormalizedMetaLead {
  name: string;
  phone: string;
  email: string;
  fields: Record<string, string>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader?.startsWith('sha256=') || !appSecret) return false;
  const received = signatureHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(received, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

export function extractLeadgenChanges(payload: unknown): MetaLeadgenChange[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as { object?: unknown; entry?: unknown };
  if (root.object !== 'page' || !Array.isArray(root.entry)) return [];

  const result: MetaLeadgenChange[] = [];
  for (const entry of root.entry) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; changes?: unknown };
    if (!Array.isArray(row.changes)) continue;
    for (const change of row.changes) {
      if (!change || typeof change !== 'object') continue;
      const item = change as { field?: unknown; value?: unknown };
      if (
        item.field !== 'leadgen' ||
        !item.value ||
        typeof item.value !== 'object'
      )
        continue;
      const value = item.value as Record<string, unknown>;
      const leadgenId = nonEmptyString(value.leadgen_id);
      const pageId = nonEmptyString(value.page_id) ?? nonEmptyString(row.id);
      if (!leadgenId || !pageId) continue;
      result.push({
        leadgenId,
        pageId,
        formId: nonEmptyString(value.form_id),
        adId: nonEmptyString(value.ad_id),
        createdTime:
          typeof value.created_time === 'number' ? value.created_time : null,
      });
    }
  }
  return result;
}

function firstField(fields: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = fields[name];
    if (value) return value;
  }
  return '';
}

export function normalizeMetaLead(
  payload: MetaLeadPayload
): NormalizedMetaLead {
  const fields: Record<string, string> = {};
  for (const field of payload.field_data ?? []) {
    const name = nonEmptyString(field.name)?.toLowerCase();
    if (!name || !Array.isArray(field.values)) continue;
    const value = field.values
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ');
    if (value) fields[name] = value;
  }

  const firstName = firstField(fields, ['first_name', 'firstname']);
  const lastName = firstField(fields, ['last_name', 'lastname']);
  const name =
    firstField(fields, ['full_name', 'name']) ||
    [firstName, lastName].filter(Boolean).join(' ');

  return {
    name,
    phone: firstField(fields, [
      'phone_number',
      'phone',
      'mobile_number',
      'mobile',
    ]),
    email: firstField(fields, ['email', 'email_address']),
    fields,
  };
}

export async function fetchMetaLead(
  leadgenId: string,
  accessToken: string
): Promise<MetaLeadPayload> {
  const fields = 'id,created_time,ad_id,form_id,field_data';
  const url = `${META_API_BASE}/${encodeURIComponent(leadgenId)}?fields=${encodeURIComponent(fields)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as MetaLeadPayload & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      body.error?.message ?? `Meta lead retrieval failed (${response.status})`
    );
  }
  return body;
}
