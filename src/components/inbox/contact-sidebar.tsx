"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type {
  Contact,
  Deal,
  ContactNote,
  Tag,
  InboxReminder,
  Pipeline,
  PipelineStage,
  CustomField,
} from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  ShoppingBag,
  Loader2,
  ExternalLink,
  Bell,
  Megaphone,
  ClipboardList,
  List,
  PanelRightClose,
} from "lucide-react";
import {
  formatShipmentStatusLabel,
  isFulfilledStatus,
} from "@/lib/shopify/order-links";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { toast } from "sonner";
import { ReminderSnoozeControls } from "@/components/inbox/reminder-snooze-controls";
import { ScheduleReminderDialog } from "@/components/inbox/schedule-reminder-dialog";
import { FormSubmissionFields } from "@/components/inbox/form-submission-fields";

interface ContactSidebarProps {
  contact: Contact | null;
  conversationId?: string | null;
  onNameClick?: () => void;
  /** Desktop-only — collapses the contact sidebar. Issue #258. */
  onToggleContactPanel?: () => void;
}

/** Session cache so revisiting a contact shows orders instantly. */
type InboxStoreOrder = {
  id: string;
  order_number: string;
  total_price?: string | null;
  currency?: string | null;
  payment_status?: string | null;
  payment_gateway?: string | null;
  order_status?: string | null;
  product_title?: string | null;
  shipping_address?: string | null;
  fulfillment_status?: string | null;
  shipment_status?: string | null;
  tracking_url?: string | null;
  tracking_number?: string | null;
  order_status_url?: string | null;
  admin_url?: string | null;
  ordered_at?: string | null;
  tags?: string[];
};

const storeOrdersCache = new Map<string, InboxStoreOrder[]>();

export function ContactSidebar({
  contact,
  conversationId,
  onNameClick,
  onToggleContactPanel,
}: ContactSidebarProps) {
  const { accountId, defaultCurrency, isLeadGenBrand, isEcommerceBrand, isWooCommerceBrand } =
    useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [stagesLoaded, setStagesLoaded] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [storeOrders, setStoreOrders] = useState<InboxStoreOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [reminders, setReminders] = useState<InboxReminder[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [formSubmissions, setFormSubmissions] = useState<
    Array<{ id: string; created_at: string; values: Record<string, string> }>
  >([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const fetchFormSubmissions = useCallback(async () => {
    if (!conversationId) {
      setFormSubmissions([]);
      return;
    }

    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("id, created_at, content_payload")
      .eq("conversation_id", conversationId)
      .eq("sender_type", "customer")
      .eq("content_type", "interactive")
      .order("created_at", { ascending: false })
      .limit(10);

    const submissions =
      data
        ?.filter(
          (row) =>
            row.content_payload &&
            typeof row.content_payload === "object" &&
            (row.content_payload as { type?: string }).type === "whatsapp_flow",
        )
        .map((row) => ({
          id: row.id as string,
          created_at: row.created_at as string,
          values:
            ((row.content_payload as { values?: Record<string, string> })
              .values as Record<string, string> | undefined) ?? {},
        })) ?? [];

    setFormSubmissions(submissions);
  }, [conversationId]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const contactId = contact.id;
    if (isLeadGenBrand) {
      setStagesLoaded(false);
    }
    const cachedOrders = storeOrdersCache.get(contactId);
    const canUseOrderCache =
      cachedOrders &&
      (!isEcommerceBrand ||
        !cachedOrders.some(
          (order) =>
            order.product_title == null ||
            /\+\d+ more$/.test(order.product_title?.trim() ?? "") ||
            (isFulfilledStatus(order.fulfillment_status) &&
              Boolean(order.tracking_url?.trim() || order.tracking_number?.trim()) &&
              !order.shipment_status?.trim()),
        ));
    if (canUseOrderCache && cachedOrders) {
      setStoreOrders(cachedOrders);
      setOrdersLoading(false);
    } else {
      setStoreOrders([]);
      setOrdersLoading(isEcommerceBrand);
    }

    const supabase = createClient();

    const ordersApiPath = isWooCommerceBrand
      ? `/api/woocommerce/orders?contact_id=${contactId}`
      : `/api/shopify/orders?contact_id=${contactId}`;

    const ordersPromise = isEcommerceBrand
      ? fetch(ordersApiPath, { cache: "no-store" })
          .then(async (res) => {
            if (!res.ok) return [] as InboxStoreOrder[];
            const payload = (await res.json()) as { orders?: InboxStoreOrder[] };
            return payload.orders ?? [];
          })
          .catch(() => [] as InboxStoreOrder[])
      : Promise.resolve([] as InboxStoreOrder[]);

    // Deals/notes/tags and Shopify orders in parallel (orders used to wait)
    const [
      dealsRes,
      notesRes,
      tagsRes,
      allTagsRes,
      orders,
      pipelinesRes,
      stagesRes,
      customFieldsRes,
      customValuesRes,
    ] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contactId),
      supabase.from("tags").select("*").order("name"),
      ordersPromise,
      isLeadGenBrand
        ? supabase.from("pipelines").select("*").order("name")
        : Promise.resolve({ data: null }),
      isLeadGenBrand
        ? supabase
            .from("pipeline_stages")
            .select("*")
            .order("position")
        : Promise.resolve({ data: null }),
      supabase.from("custom_fields").select("*").order("field_name"),
      supabase
        .from("contact_custom_values")
        .select("*")
        .eq("contact_id", contactId),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (isLeadGenBrand) {
      setPipelines((pipelinesRes.data as Pipeline[] | null) ?? []);
      setPipelineStages((stagesRes.data as PipelineStage[] | null) ?? []);
      setStagesLoaded(true);
    } else {
      setPipelines([]);
      setPipelineStages([]);
      setStagesLoaded(false);
    }
    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    } else {
      setTags([]);
    }

    if (customFieldsRes.data) {
      setCustomFields(customFieldsRes.data);
    } else {
      setCustomFields([]);
    }
    if (customValuesRes.data) {
      const map: Record<string, string> = {};
      for (const row of customValuesRes.data) {
        map[row.custom_field_id as string] = (row.value as string | null) ?? "";
      }
      setCustomValues(map);
    } else {
      setCustomValues({});
    }

    if (isEcommerceBrand) {
      storeOrdersCache.set(contactId, orders);
      setStoreOrders(orders);
      setOrdersLoading(false);
    }
  }, [contact, isEcommerceBrand, isLeadGenBrand, isWooCommerceBrand]);

  const fetchReminders = useCallback(async () => {
    if (!conversationId) {
      setReminders([]);
      return;
    }
    setRemindersLoading(true);
    try {
      const res = await fetch(
        `/api/inbox/reminders?conversation_id=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setReminders([]);
        return;
      }
      const data = (await res.json()) as { reminders?: InboxReminder[] };
      setReminders(data.reminders ?? []);
    } catch {
      setReminders([]);
    } finally {
      setRemindersLoading(false);
    }
  }, [conversationId]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchReminders();
  }, [fetchReminders]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchFormSubmissions();
  }, [fetchFormSubmissions]);

  const handleCompleteReminder = useCallback(
    async (id: string) => {
      setCompletingId(id);
      try {
        const res = await fetch(`/api/inbox/reminders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete" }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          toast.error(body?.error ?? "Failed to complete reminder");
          return;
        }
        setReminders((prev) => prev.filter((r) => r.id !== id));
        toast.success("Reminder completed");
      } catch {
        toast.error("Failed to complete reminder");
      } finally {
        setCompletingId(null);
      }
    },
    [],
  );

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleToggleTag = useCallback(
    async (tagId: string) => {
      if (!contact) return;
      setSavingTags(true);

      const supabase = createClient();
      const applied = tags.some((t) => t.id === tagId);

      if (applied) {
        const { error } = await supabase
          .from("contact_tags")
          .delete()
          .eq("contact_id", contact.id)
          .eq("tag_id", tagId);

        if (!error) {
          setTags((prev) => prev.filter((t) => t.id !== tagId));
          if (accountId) {
            void fetch("/api/crm/triggers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                trigger_type: "tag_removed",
                contact_id: contact.id,
                tag_id: tagId,
              }),
            });
          }
        } else {
          toast.error("Failed to remove tag");
        }
      } else {
        const { data, error } = await supabase
          .from("contact_tags")
          .insert({ contact_id: contact.id, tag_id: tagId })
          .select("id")
          .single();

        const tag = allTags.find((t) => t.id === tagId);
        if (!error && data && tag) {
          setTags((prev) => [
            ...prev,
            { ...tag, contact_tag_id: data.id as string },
          ]);
          if (accountId) {
            void fetch("/api/crm/triggers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                trigger_type: "tag_added",
                contact_id: contact.id,
                tag_id: tagId,
              }),
            });
          }
        } else {
          toast.error("Failed to add tag");
        }
      }

      setSavingTags(false);
    },
    [contact, tags, accountId, allTags],
  );

  const handleStageChange = useCallback(
    async (newStageId: string) => {
      if (!contact || !accountId || !newStageId) return;

      const stage = pipelineStages.find((s) => s.id === newStageId);
      if (!stage) return;

      const primaryDeal =
        deals.find((d) => d.status === "open" || !d.status) ?? deals[0] ?? null;

      if (primaryDeal?.stage_id === newStageId) return;

      setSavingStage(true);
      const supabase = createClient();

      if (primaryDeal) {
        setDeals((prev) =>
          prev.map((d) =>
            d.id === primaryDeal.id
              ? { ...d, stage_id: newStageId, stage }
              : d,
          ),
        );

        const { error } = await supabase
          .from("deals")
          .update({ stage_id: newStageId })
          .eq("id", primaryDeal.id);

        if (error) {
          toast.error("Failed to update lead stage");
          void fetchContactData();
        } else {
          void fetch("/api/crm/triggers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trigger_type: "deal_stage_changed",
              contact_id: contact.id,
              stage_id: newStageId,
            }),
          });
        }
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) {
          toast.error("Not signed in");
          setSavingStage(false);
          return;
        }

        const title = contact.name?.trim() || contact.phone;
        const { data, error } = await supabase
          .from("deals")
          .insert({
            user_id: user.id,
            account_id: accountId,
            pipeline_id: stage.pipeline_id,
            stage_id: newStageId,
            contact_id: contact.id,
            conversation_id: conversationId ?? undefined,
            title,
            value: 0,
            currency: defaultCurrency,
            status: "open",
          })
          .select("*, stage:pipeline_stages(*)")
          .single();

        if (error) {
          toast.error("Failed to create deal");
        } else if (data) {
          setDeals((prev) => [data as Deal, ...prev]);
          void fetch("/api/crm/triggers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trigger_type: "deal_stage_changed",
              contact_id: contact.id,
              stage_id: newStageId,
            }),
          });
        }
      }

      setSavingStage(false);
    },
    [
      contact,
      accountId,
      pipelineStages,
      deals,
      conversationId,
      defaultCurrency,
      fetchContactData,
    ],
  );

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full min-h-0 w-70 items-center justify-center overflow-hidden border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const primaryDeal =
    deals.find((d) => d.status === "open" || !d.status) ?? deals[0] ?? null;
  const activePipelineId =
    primaryDeal?.pipeline_id ?? pipelines[0]?.id ?? null;
  const stagesForPipeline = activePipelineId
    ? pipelineStages.filter((s) => s.pipeline_id === activePipelineId)
    : [];
  const leadStageSelectItems = [
    ...stagesForPipeline.map((stage) => ({
      value: stage.id,
      label: (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: stage.color }}
          />
          {stage.name}
        </span>
      ),
    })),
  ];
  if (
    primaryDeal?.stage_id &&
    !stagesForPipeline.some((s) => s.id === primaryDeal.stage_id) &&
    primaryDeal.stage
  ) {
    leadStageSelectItems.push({
      value: primaryDeal.stage_id,
      label: primaryDeal.stage.name,
    });
  }

  return (
    <div className="flex h-full min-h-0 w-70 flex-col overflow-hidden border-l border-border bg-card">
      {onToggleContactPanel && (
        <div className="flex shrink-0 items-center justify-end border-b border-border px-2 py-1.5">
          <button
            type="button"
            onClick={onToggleContactPanel}
            aria-label="Hide contact panel"
            title="Hide contact"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      )}
      {/* `min-h-0` lets the ScrollArea shrink inside the flex column
          instead of growing with content and getting clipped (#inbox). */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            {onNameClick ? (
              <button
                type="button"
                onClick={onNameClick}
                className="cursor-pointer text-sm font-semibold text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
                title="Open contact"
              >
                {displayName}
              </button>
            ) : (
              <h3 className="text-sm font-semibold text-foreground">
                {displayName}
              </h3>
            )}
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {isEcommerceBrand && (
            <div className="mt-4">
              <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <ShoppingBag className="h-3 w-3" />
                {isWooCommerceBrand ? 'WooCommerce Orders' : 'Shopify Orders'}
              </div>
              <div className="mt-2 space-y-2">
                {ordersLoading ? (
                  <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading orders…
                  </div>
                ) : storeOrders.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    {isWooCommerceBrand ? 'No WooCommerce orders' : 'No Shopify orders'}
                  </p>
                ) : (
                  storeOrders.map((order) => (
                    <div key={order.id} className="rounded-lg bg-muted px-3 py-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {order.admin_url ? (
                            <a
                              href={order.admin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-primary hover:underline"
                            >
                              {order.order_number}
                            </a>
                          ) : (
                            <span className="font-medium text-foreground">{order.order_number}</span>
                          )}
                          {!isWooCommerceBrand && order.product_title && (
                            <p className="mt-0.5 whitespace-pre-line text-[11px] font-normal leading-snug text-muted-foreground">
                              {order.product_title}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-muted-foreground">
                          {order.currency ?? ""}
                          {order.total_price ?? "—"}
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                        {order.ordered_at && (
                          <p>
                            Received:{" "}
                            <span className="text-foreground">
                              {format(new Date(order.ordered_at), "MMM d, yyyy")}
                            </span>
                          </p>
                        )}
                        {!isWooCommerceBrand && order.order_status === "cancelled" && (
                          <p>
                            Status:{" "}
                            <span className="text-destructive">Cancelled</span>
                          </p>
                        )}
                        <p>
                          Payment:{" "}
                          <span className="text-foreground">
                            {formatPaymentLabel(order.payment_gateway, order.payment_status)}
                          </span>
                        </p>
                        {!isFulfilledStatus(order.fulfillment_status) && (
                          <p>
                            Fulfillment:{" "}
                            <span className="text-foreground">
                              {formatFulfillment(order.fulfillment_status)}
                            </span>
                          </p>
                        )}
                        {isFulfilledStatus(order.fulfillment_status) &&
                          (order.tracking_url || order.order_status_url || order.tracking_number) && (
                          <p>
                            Tracking:{" "}
                            <span className="inline-flex flex-wrap items-center gap-x-1">
                              {order.tracking_url ? (
                                <a
                                  href={order.tracking_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                >
                                  Track shipment
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : order.order_status_url ? (
                                <a
                                  href={order.order_status_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                >
                                  View order status
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-foreground">{order.tracking_number}</span>
                              )}
                              {order.shipment_status && formatShipmentStatusLabel(order.shipment_status) && (
                                <>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-foreground">
                                    {formatShipmentStatusLabel(order.shipment_status)}
                                  </span>
                                </>
                              )}
                            </span>
                          </p>
                        )}
                        {!isWooCommerceBrand && order.shipping_address && (
                          <details className="group/shipping">
                            <summary className="cursor-pointer list-none text-primary marker:content-none hover:underline [&::-webkit-details-marker]:hidden">
                              Shipping address
                            </summary>
                            <p className="mt-1 whitespace-pre-line text-foreground">
                              {order.shipping_address}
                            </p>
                          </details>
                        )}
                        {order.order_status_url && order.tracking_url ? (
                          <a
                            href={order.order_status_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View order status
                          </a>
                        ) : null}
                        {(order.tags?.length ?? 0) > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(order.tags ?? []).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Follow-up reminders */}
          {conversationId ? (
            <div className="mt-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Bell className="h-3 w-3" />
                  Reminders
                </div>
                <button
                  type="button"
                  onClick={() => setReminderDialogOpen(true)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Schedule reminder"
                  title="Schedule reminder"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {remindersLoading ? (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </div>
                ) : reminders.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    No open reminders
                  </p>
                ) : (
                  reminders.map((reminder) => {
                    const isDue =
                      new Date(reminder.due_at).getTime() <= Date.now();
                    const busy = completingId === reminder.id;
                    return (
                      <div
                        key={reminder.id}
                        className={cn(
                          "rounded-lg border border-border px-3 py-2",
                          isDue && "border-amber-500/40 bg-amber-500/5",
                        )}
                      >
                        <p className="text-sm text-foreground">{reminder.note}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Follow up:{" "}
                          {reminder.assignee?.full_name?.trim() || "Team member"}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {isDue ? "Due" : "Scheduled"}{" "}
                          {format(new Date(reminder.due_at), "PPp")}
                        </p>
                        <div className="mt-2 flex flex-col gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="w-full"
                            disabled={busy}
                            onClick={() =>
                              void handleCompleteReminder(reminder.id)
                            }
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Complete
                          </Button>
                          {snoozeId === reminder.id ? (
                            <>
                              <ReminderSnoozeControls
                                reminderId={reminder.id}
                                disabled={busy}
                                onSnoozed={() => {
                                  setReminders((prev) =>
                                    prev.filter((r) => r.id !== reminder.id),
                                  );
                                  setSnoozeId(null);
                                  void fetchReminders();
                                }}
                              />
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => setSnoozeId(null)}
                              >
                                Cancel snooze
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="text-xs font-medium text-primary hover:underline"
                              onClick={() => setSnoozeId(reminder.id)}
                            >
                              Snooze…
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <ScheduleReminderDialog
                open={reminderDialogOpen}
                onOpenChange={setReminderDialogOpen}
                conversationId={conversationId}
                contactLabel={
                  contact?.name?.trim() || contact?.phone || undefined
                }
                onScheduled={() => void fetchReminders()}
              />
            </div>
          ) : null}

          {/* Tags */}
          <div className="mt-4">
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {allTags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  No tags yet. Create tags in Settings → Fields &amp; tags.
                </p>
              ) : (
                allTags.map((tag) => {
                  const selected = tags.some((t) => t.id === tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleToggleTag(tag.id)}
                      disabled={savingTags}
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-all",
                        selected
                          ? "ring-1 ring-primary ring-offset-1 ring-offset-background"
                          : "opacity-50 hover:opacity-80",
                      )}
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      {selected && <Check className="mr-0.5 h-2.5 w-2.5" />}
                      {tag.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {customFields.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <List className="h-3 w-3" />
                Details
              </div>
              <div className="mt-2 space-y-1.5 rounded-lg border border-border px-3 py-2 text-xs">
                {customFields.map((field) => (
                  <div key={field.id} className="flex justify-between gap-3">
                    <span className="shrink-0 capitalize text-muted-foreground">
                      {field.field_name}
                    </span>
                    <span className="text-right text-foreground">
                      {customValues[field.id]?.trim() || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {contact.referral && (
            <div className="mt-4">
              <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Megaphone className="h-3 w-3" />
                Ad source
              </div>
              <div className="mt-2 space-y-1 rounded-lg border border-border px-3 py-2 text-xs">
                {contact.referral.headline && (
                  <p className="text-sm font-medium text-foreground">
                    {contact.referral.headline}
                  </p>
                )}
                {contact.referral.body && (
                  <p className="text-muted-foreground">{contact.referral.body}</p>
                )}
                {contact.referral.source_type && (
                  <p className="text-muted-foreground">
                    Source: {contact.referral.source_type}
                    {contact.referral.source_id
                      ? ` · ${contact.referral.source_id}`
                      : ""}
                  </p>
                )}
                {contact.referral.source_url && (
                  <a
                    href={contact.referral.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View ad
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {formSubmissions.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <ClipboardList className="h-3 w-3" />
                Form responses
              </div>
              <div className="mt-2 space-y-3">
                {formSubmissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="rounded-lg border border-border px-3 py-2"
                  >
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(submission.created_at), "PPp")}
                    </p>
                    <FormSubmissionFields values={submission.values} compact />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isLeadGenBrand && (
          <>
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              Active Deals
            </div>
            <div className="mt-2 space-y-2">
              {!stagesLoaded ? (
                <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading stages…
                </div>
              ) : stagesForPipeline.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  No pipeline stages yet. Create one under Pipelines.
                </p>
              ) : (
                <div className="px-1">
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Lead stage
                  </label>
                  <Select
                    value={primaryDeal?.stage_id || undefined}
                    items={leadStageSelectItems}
                    onValueChange={(value) => {
                      if (value) void handleStageChange(value);
                    }}
                    disabled={savingStage}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-full bg-muted text-xs"
                    >
                      {savingStage ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Saving…
                        </span>
                      ) : (
                        <SelectValue placeholder="Select lead stage…" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {stagesForPipeline.map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: stage.color }}
                          />
                          {stage.name}
                        </SelectItem>
                      ))}
                      {primaryDeal?.stage_id &&
                        !stagesForPipeline.some(
                          (s) => s.id === primaryDeal.stage_id,
                        ) &&
                        primaryDeal.stage && (
                          <SelectItem value={primaryDeal.stage_id}>
                            {primaryDeal.stage.name}
                          </SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {deals.length > 0 && (
                <div className="space-y-2 pt-1">
                  {deals.map((deal) => (
                    <div
                      key={deal.id}
                      className="rounded-lg bg-muted px-3 py-2"
                    >
                      <p className="text-sm font-medium text-foreground">
                        {deal.title}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {deal.currency ?? "$"}
                          {deal.value.toLocaleString()}
                        </span>
                        {deal.stage && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${deal.stage.color}20`,
                              color: deal.stage.color,
                            }}
                          >
                            {deal.stage.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />
          </>
          )}

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              Notes
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function formatPaymentLabel(gateway: string | null | undefined, status: string | null | undefined) {
  const parts = [gateway, status].filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .map((p) => p!.replace(/_/g, " "))
    .join(" · ");
}

function formatFulfillment(status: string | null | undefined) {
  if (!status) return "Unfulfilled";
  return status.replace(/_/g, " ");
}
