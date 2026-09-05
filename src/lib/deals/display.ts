import type { Contact, Deal, PipelineStage } from "@/types";

export function contactDisplayName(
  contact?: Pick<Contact, "name" | "phone"> | null,
): string | null {
  return contact?.name?.trim() || contact?.phone || null;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function titleMatchesStageName(
  title: string,
  stages: Pick<PipelineStage, "name">[],
): boolean {
  const normalized = normalizeLabel(title);
  if (!normalized) return false;
  return stages.some((s) => normalizeLabel(s.name) === normalized);
}

export function resolveDealCardContactFields(
  deal: Pick<Deal, "title"> & { contact?: Contact | null },
): { name: string; phone: string | null; company: string | null } {
  const phone = deal.contact?.phone?.trim() || null;
  const nameFromContact = deal.contact?.name?.trim() || null;
  const title = deal.title?.trim() || null;
  const name =
    nameFromContact ||
    (title && title !== phone ? title : null) ||
    "Unknown";

  return {
    name,
    phone,
    company: deal.contact?.company?.trim() || null,
  };
}

export function resolveDealCardLabel(
  deal: Pick<Deal, "title"> & { contact?: Contact | null },
): string {
  return contactDisplayName(deal.contact) || deal.title?.trim() || "Unknown";
}

export function resolveDealCardSubtitle(
  deal: Pick<Deal, "title"> & { contact?: Contact | null },
  stage: Pick<PipelineStage, "name"> | null | undefined,
  cardLabel: string,
): string | null {
  const titleTrimmed = deal.title?.trim();
  if (!titleTrimmed) return null;

  const titleNorm = normalizeLabel(titleTrimmed);
  const cardNorm = normalizeLabel(cardLabel);
  const contactNorm = normalizeLabel(contactDisplayName(deal.contact) ?? "");
  const stageNorm = normalizeLabel(stage?.name ?? "");

  if (
    titleNorm === cardNorm ||
    titleNorm === contactNorm ||
    titleNorm === stageNorm
  ) {
    return null;
  }

  return titleTrimmed;
}

/** Returns a contact-based title when the current title is empty or looks like a stage name. */
export function suggestDealTitle(
  contact: Pick<Contact, "name" | "phone"> | undefined,
  currentTitle: string,
  stages: Pick<PipelineStage, "name">[],
): string | null {
  const contactName = contactDisplayName(contact);
  if (!contactName) return null;

  const trimmed = currentTitle.trim();
  if (!trimmed || titleMatchesStageName(trimmed, stages)) {
    return contactName;
  }

  return null;
}

export function resolveDealInsertTitle(args: {
  configuredTitle: string;
  contact?: Pick<Contact, "name" | "phone"> | null;
  stageName?: string | null;
}): string {
  const contactTitle = contactDisplayName(args.contact);
  const trimmed = args.configuredTitle.trim();
  const stageNorm = normalizeLabel(args.stageName ?? "");

  if (
    !trimmed ||
    (stageNorm && normalizeLabel(trimmed) === stageNorm)
  ) {
    return contactTitle || trimmed || "Deal";
  }

  return trimmed;
}
