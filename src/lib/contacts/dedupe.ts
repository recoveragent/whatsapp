import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalContactPhone,
  contactLookupSuffixes,
  normalizePhone,
  phonesMatch,
} from "@/lib/whatsapp/phone-utils";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set — the exact approach the webhook has used.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffixes = contactLookupSuffixes(normalized);
  const orFilter = suffixes.map((suffix) => `phone.like.%${suffix}`).join(",");

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .or(orFilter);

  if (error || !data?.length) return null;

  const matches = (data as ExistingContact[]).filter((c) =>
    phonesMatch(c.phone, phone),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  const targetCanonical = canonicalContactPhone(normalized);

  // When Meta variant storage split a number across two contacts, prefer
  // the oldest row — it usually holds the Shopify outbound that landed
  // before the customer's first inbound reply opened a duplicate shell.
  matches.sort((a, b) => {
    const aExact =
      normalizePhone(a.phone) === normalized ||
      canonicalContactPhone(a.phone) === targetCanonical
        ? 0
        : 1;
    const bExact =
      normalizePhone(b.phone) === normalized ||
      canonicalContactPhone(b.phone) === targetCanonical
        ? 0
        : 1;
    if (aExact !== bExact) return aExact - bExact;

    const aCreated =
      typeof a.created_at === "string" ? a.created_at : "";
    const bCreated =
      typeof b.created_at === "string" ? b.created_at : "";
    return aCreated.localeCompare(bCreated);
  });

  return matches[0]!;
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each. Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
