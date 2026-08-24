import { formatFormFieldLabel } from "@/lib/whatsapp/flow-form-message";

interface FormSubmissionFieldsProps {
  values: Record<string, string>;
  /** When true, omit fields already shown in content_text summary. */
  compact?: boolean;
}

export function FormSubmissionFields({
  values,
  compact = false,
}: FormSubmissionFieldsProps) {
  const entries = Object.entries(values).filter(([, v]) => v.trim());
  if (entries.length === 0) return null;

  if (compact && entries.length <= 3) {
    return (
      <dl className="mt-1 space-y-1">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-2 text-xs">
            <dt className="truncate text-muted-foreground">
              {formatFormFieldLabel(key)}
            </dt>
            <dd className="break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="mt-1.5 space-y-1.5 rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {formatFormFieldLabel(key)}
          </dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
