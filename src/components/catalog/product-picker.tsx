"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Loader2, Search, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ShopifyProductOption {
  shopify_variant_id: number;
  title: string;
  variant_title: string | null;
  price: string;
  currency: string | null;
  image_url: string | null;
  inventory_quantity: number | null;
  in_stock: boolean;
}

interface ShopifyProductGroup {
  shopify_product_id: number;
  title: string;
  image_url: string | null;
  currency: string | null;
  variants: ShopifyProductOption[];
}

interface ProductPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (product: ShopifyProductOption) => void;
}

type PickerStep = "browse" | "variants" | "confirm";

function formatPrice(price: string, currency: string | null): string {
  const normalized = price.trim() || "0.00";
  if (currency === "INR") return `₹${normalized}`;
  if (currency) return `${currency} ${normalized}`;
  return normalized;
}

function formatVariantLabel(variantTitle: string | null): string {
  const trimmed = variantTitle?.trim();
  if (!trimmed || trimmed.toLowerCase() === "default title") {
    return "Standard";
  }
  return trimmed;
}

function inStockVariants(group: ShopifyProductGroup): ShopifyProductOption[] {
  return group.variants.filter((variant) => variant.in_stock);
}

function ProductThumbnail({
  imageUrl,
  className,
}: {
  imageUrl: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted",
        className,
      )}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        <ShoppingBag className="size-4 text-muted-foreground" />
      )}
    </div>
  );
}

export function ProductPicker({
  open,
  onOpenChange,
  onSelect,
}: ProductPickerProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ShopifyProductGroup[]>([]);
  const [step, setStep] = useState<PickerStep>("browse");
  const [selectedGroup, setSelectedGroup] = useState<ShopifyProductGroup | null>(
    null,
  );
  const [selectedVariant, setSelectedVariant] =
    useState<ShopifyProductOption | null>(null);

  const resetFlow = useCallback(() => {
    setStep("browse");
    setSelectedGroup(null);
    setSelectedVariant(null);
  }, []);

  const loadProducts = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("grouped", "true");
      params.set("limit", "200");
      if (search.trim()) params.set("q", search.trim());

      const res = await fetch(`/api/shopify/products?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to load products");
      }

      setGroups((payload.products ?? []) as ShopifyProductGroup[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load products");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadProducts(query);
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [open, query, loadProducts]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setGroups([]);
      resetFlow();
    }
  }, [open, resetFlow]);

  const handleSelectGroup = (group: ShopifyProductGroup) => {
    const variants = inStockVariants(group);
    if (variants.length === 0) return;

    setSelectedGroup(group);
    if (variants.length === 1) {
      setSelectedVariant(variants[0] ?? null);
      setStep("confirm");
      return;
    }

    setSelectedVariant(null);
    setStep("variants");
  };

  const handleSelectVariant = (variant: ShopifyProductOption) => {
    setSelectedVariant(variant);
    setStep("confirm");
  };

  const handleBack = () => {
    if (step === "confirm") {
      const variants = selectedGroup ? inStockVariants(selectedGroup) : [];
      setStep(variants.length > 1 ? "variants" : "browse");
      if (variants.length <= 1) {
        setSelectedGroup(null);
        setSelectedVariant(null);
      }
      return;
    }

    if (step === "variants") {
      resetFlow();
    }
  };

  const handleConfirmSend = () => {
    if (!selectedVariant) return;
    onSelect(selectedVariant);
    onOpenChange(false);
  };

  const dialogTitle =
    step === "browse"
      ? "Send product"
      : step === "variants"
        ? "Choose variant"
        : "Confirm product";

  const dialogDescription =
    step === "browse"
      ? "Pick a product, choose the variant, then confirm before sending."
      : step === "variants"
        ? `Select a variant for ${selectedGroup?.title ?? "this product"}.`
        : "Review the product card before sending it to the customer.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step !== "browse" ? (
              <button
                type="button"
                onClick={handleBack}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Back"
              >
                <ChevronLeft className="size-4" />
              </button>
            ) : (
              <ShoppingBag className="size-4" />
            )}
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {step === "browse" ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products..."
                className="pl-9"
                autoFocus
              />
            </div>

            <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading products...
                </div>
              ) : groups.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {query.trim()
                    ? "No products match your search."
                    : "No active products yet. Sync your catalog in Shopify settings."}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {groups.map((group) => {
                    const variants = inStockVariants(group);
                    const variantCount = variants.length;
                    const priceFrom = variants.reduce<string | null>(
                      (lowest, variant) => {
                        if (!lowest) return variant.price;
                        return Number(variant.price) < Number(lowest)
                          ? variant.price
                          : lowest;
                      },
                      null,
                    );

                    return (
                      <li key={group.shopify_product_id}>
                        <button
                          type="button"
                          disabled={variantCount === 0}
                          onClick={() => handleSelectGroup(group)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                            variantCount === 0 &&
                              "cursor-not-allowed opacity-50",
                          )}
                        >
                          <ProductThumbnail
                            imageUrl={group.image_url}
                            className="size-12"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {group.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {variantCount === 0
                                ? "Out of stock"
                                : variantCount === 1
                                  ? formatPrice(
                                      variants[0]!.price,
                                      group.currency,
                                    )
                                  : `${variantCount} variants · from ${formatPrice(priceFrom ?? "0.00", group.currency)}`}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}

        {step === "variants" && selectedGroup ? (
          <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {inStockVariants(selectedGroup).map((variant) => (
                <li key={variant.shopify_variant_id}>
                  <button
                    type="button"
                    onClick={() => handleSelectVariant(variant)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60"
                  >
                    <ProductThumbnail
                      imageUrl={variant.image_url ?? selectedGroup.image_url}
                      className="size-10"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {formatVariantLabel(variant.variant_title)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPrice(variant.price, variant.currency)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === "confirm" && selectedGroup && selectedVariant ? (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <ProductThumbnail
                imageUrl={
                  selectedVariant.image_url ?? selectedGroup.image_url
                }
                className="size-16"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {selectedGroup.title}
                </p>
                <p className="text-sm text-foreground/80">
                  {formatVariantLabel(selectedVariant.variant_title)}
                </p>
                <p className="text-sm font-medium text-primary">
                  {formatPrice(selectedVariant.price, selectedVariant.currency)}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The customer will receive a WhatsApp product card with a Buy now
              button that opens checkout on your Shopify store.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button onClick={handleConfirmSend}>Send product</Button>
            </div>
          </div>
        ) : null}

        {step !== "confirm" ? (
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
