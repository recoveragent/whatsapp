import type { Deal } from "@/types";
import { contactDisplayName } from "@/lib/deals/display";

export type PipelineDealDateField = "received" | "updated";

function dealSearchHaystack(deal: Deal): string {
  const parts = [
    deal.title,
    deal.contact?.name,
    deal.contact?.phone,
    deal.contact?.company,
    deal.contact?.email,
    deal.assignee?.full_name,
    deal.assignee?.email,
    contactDisplayName(deal.contact),
  ];
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .toLowerCase();
}

function startOfDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function endOfDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function parseDealDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dealDateForField(
  deal: Deal,
  dateField: PipelineDealDateField,
): Date | null {
  if (dateField === "updated") {
    return parseDealDate(deal.updated_at) ?? parseDealDate(deal.created_at);
  }
  return parseDealDate(deal.created_at);
}

export function filterPipelineDeals(
  deals: Deal[],
  args: {
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    dateField?: PipelineDealDateField;
  },
): Deal[] {
  const term = args.search?.trim().toLowerCase() ?? "";
  const from = args.dateFrom?.trim() ?? "";
  const to = args.dateTo?.trim() ?? "";
  const dateField = args.dateField ?? "received";
  const fromDate = from ? startOfDay(from) : null;
  const toDate = to ? endOfDay(to) : null;

  return deals.filter((deal) => {
    if (term && !dealSearchHaystack(deal).includes(term)) {
      return false;
    }

    const dealDate = dealDateForField(deal, dateField);
    if ((fromDate || toDate) && !dealDate) return false;
    if (fromDate && dealDate && dealDate < fromDate) return false;
    if (toDate && dealDate && dealDate > toDate) return false;

    return true;
  });
}

export function hasActivePipelineDealFilters(args: {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}): boolean {
  return Boolean(
    args.search?.trim() || args.dateFrom?.trim() || args.dateTo?.trim(),
  );
}
