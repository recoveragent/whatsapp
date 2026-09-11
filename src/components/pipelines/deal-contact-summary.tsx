"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact, CustomField } from "@/types";
import { Building2, Mail, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { contactDisplayName } from "@/lib/deals/display";

interface DealContactSummaryProps {
  contact: Contact | null;
  contactId: string | null;
}

export function DealContactSummary({
  contact,
  contactId,
}: DealContactSummaryProps) {
  const t = useTranslations("Contacts.detailView");
  const supabase = createClient();
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!contactId) {
      setCustomFields([]);
      setCustomValues({});
      return;
    }

    let cancelled = false;
    (async () => {
      const [fieldsRes, valuesRes] = await Promise.all([
        supabase.from("custom_fields").select("*").order("field_name"),
        supabase
          .from("contact_custom_values")
          .select("*")
          .eq("contact_id", contactId),
      ]);
      if (cancelled) return;

      setCustomFields((fieldsRes.data ?? []) as CustomField[]);
      const map: Record<string, string> = {};
      for (const row of valuesRes.data ?? []) {
        map[row.custom_field_id as string] = (row.value as string | null) ?? "";
      }
      setCustomValues(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [contactId, supabase]);

  const displayName = contactDisplayName(contact) ?? t("unnamed");
  const phone = contact?.phone?.trim() || null;
  const email = contact?.email?.trim() || null;
  const company = contact?.company?.trim() || null;
  const showPhone = phone && phone !== displayName;

  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5">
      <p className="text-sm font-medium tracking-tight text-foreground">
        {displayName}
      </p>

      <div className="space-y-1">
        {showPhone ? <DetailRow icon={Phone} value={phone} /> : null}
        {company ? <DetailRow icon={Building2} value={company} /> : null}
        {email ? <DetailRow icon={Mail} value={email} /> : null}
      </div>

      {customFields.length > 0 ? (
        <div className="space-y-1 border-t border-border/50 pt-2">
          <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {t("customFields")}
          </p>
          {customFields.map((field) => (
            <div key={field.id} className="flex justify-between gap-3 text-xs">
              <span className="shrink-0 text-muted-foreground capitalize">
                {field.field_name}
              </span>
              <span className="text-right break-words text-foreground">
                {customValues[field.id]?.trim() || "—"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  value,
}: {
  icon: typeof Phone;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="size-3 shrink-0" />
      <span className="break-all">{value}</span>
    </div>
  );
}
