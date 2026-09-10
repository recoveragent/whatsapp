"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, ShoppingBag } from "lucide-react";
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

interface ProductPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (product: ShopifyProductOption) => void;
}

function formatPrice(price: string, currency: string | null): string {
  const normalized = price.trim() || "0.00";
  if (currency === "INR") return `₹${normalized}`;
  if (currency) return `${currency} ${normalized}`;
  return normalized;
}

function formatVariantLabel(variantTitle: string | null): string | null {
  const trimmed = variantTitle?.trim();
  if (!trimmed || trimmed.toLowerCase() === "default title") return null;
  return trimmed;
}

export function ProductPicker({
  open,
  onOpenChange,
  onSelect,
}: ProductPickerProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ShopifyProductOption[]>([]);

  const loadProducts = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      params.set("limit", "50");

      const res = await fetch(`/api/shopify/products?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to load products");
      }

      setProducts((payload.products ?? []) as ShopifyProductOption[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load products");
      setProducts([]);
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
      setProducts([]);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4" />
            Send product
          </DialogTitle>
          <DialogDescription>
            Choose a product from your synced Shopify catalog. Customers tap Buy
            now to open checkout on your store.
          </DialogDescription>
        </DialogHeader>

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
          ) : products.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {query.trim()
                ? "No products match your search."
                : "No active products yet. Sync your catalog in Shopify settings."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {products.map((product) => {
                const variantLabel = formatVariantLabel(product.variant_title);
                return (
                <li key={product.shopify_variant_id}>
                  <button
                    type="button"
                    disabled={!product.in_stock}
                    onClick={() => {
                      onSelect(product);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                      !product.in_stock && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.image_url}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <ShoppingBag className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {product.title}
                      </p>
                      {variantLabel ? (
                        <p className="truncate text-xs font-medium text-foreground/80">
                          {variantLabel}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {formatPrice(product.price, product.currency)}
                        {!product.in_stock ? " · Out of stock" : ""}
                      </p>
                    </div>
                  </button>
                </li>
              );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
