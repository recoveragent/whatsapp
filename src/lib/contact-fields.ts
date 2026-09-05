import type { CustomField } from "@/types";

export const BUILTIN_CONTACT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  company: "Company",
};

/** Human-readable label for a contact field key (`name`, `email`, `custom:<id>`, …). */
export function resolveContactFieldLabel(
  value: string,
  customFields: CustomField[] = [],
  options?: { loading?: boolean },
): string {
  if (!value) return BUILTIN_CONTACT_FIELD_LABELS.name;

  const builtin = BUILTIN_CONTACT_FIELD_LABELS[value];
  if (builtin) return builtin;

  if (value.startsWith("custom:")) {
    const id = value.slice("custom:".length);
    const match = customFields.find((field) => field.id === id);
    if (match) return match.field_name;
    if (options?.loading) return "Loading…";
    return "Unknown field";
  }

  return value;
}
