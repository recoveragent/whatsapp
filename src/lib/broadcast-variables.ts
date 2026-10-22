// ============================================================
// Broadcast template-variable resolution, shared by the send hook and
// the step 3 preview so the preview shows exactly what is sent.
// ============================================================

import type { Contact } from '@/types';

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 *
 * `fallback` is literal text or an attribute key according to `fallbackType`,
 * resolved when a field/custom_field value is blank
 * for a contact. Without one the param goes out empty, Meta rejects the
 * message, and that recipient is marked failed. Ignored for `static`.
 */
export type VariableMapping = {
  type: 'static' | 'field' | 'custom_field';
  value: string;
  fallback?: string;
  /** Omitted for existing mappings, whose fallback is literal text. */
  fallbackType?: 'static' | 'field' | 'custom_field';
};

/** One placeholder's value for one contact ('' when nothing resolves). */
export function resolveVariable(
  mapping: VariableMapping,
  contact: Contact,
  customValues?: Map<string, string>
): string {
  if (mapping.type === 'static') return mapping.value;

  let raw: string | undefined;
  if (mapping.type === 'field') {
    const fieldMap: Record<string, string | undefined> = {
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
    };
    raw = fieldMap[mapping.value];
  } else {
    raw = customValues?.get(mapping.value);
  }

  // Whitespace-only counts as empty — Meta rejects it the same way.
  if (raw?.trim()) return raw;
  if (!mapping.fallbackType || mapping.fallbackType === 'static') {
    return mapping.fallback?.trim() ?? '';
  }
  return resolveVariable(
    { type: mapping.fallbackType, value: mapping.fallback ?? '' },
    contact,
    customValues
  );
}

/**
 * Per-contact resolution of every placeholder, in placeholder order.
 * Custom fields read from a pre-built index to avoid N+1 queries
 * during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) =>
    resolveVariable(variables[key], contact, customValues)
  );
}
