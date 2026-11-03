'use client';

import { ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';
import { useRef } from 'react';

import type { PlaygroundProductCarousel } from '@/lib/ai/playground-carousel';
import { cn } from '@/lib/utils';

function productLabel(
  product: PlaygroundProductCarousel['products'][number]
): string {
  const variant = product.variant_title?.trim();
  if (
    variant &&
    variant.toLowerCase() !== 'default title' &&
    !product.title.includes(variant)
  ) {
    return `${product.title} (${variant})`;
  }
  return product.title;
}

export function PlaygroundProductCarouselPreview({
  carousel,
  className,
}: {
  carousel: PlaygroundProductCarousel;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    const node = scrollerRef.current;
    if (!node) return;
    const amount = Math.max(node.clientWidth * 0.75, 180);
    node.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  return (
    <div className={cn('mt-2 space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
          <ShoppingBag className="h-3 w-3" />
          {carousel.products.length === 1
            ? 'Product card preview'
            : 'Product carousel preview'}
        </span>
        {carousel.products.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scroll('left')}
              className="border-border text-muted-foreground hover:bg-muted rounded-md border p-1"
              aria-label="Scroll carousel left"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              className="border-border text-muted-foreground hover:bg-muted rounded-md border p-1"
              aria-label="Scroll carousel right"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory [scrollbar-width:none] gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {carousel.products.map((product) => (
          <article
            key={product.shopify_variant_id}
            className="border-border bg-background w-[168px] shrink-0 snap-start overflow-hidden rounded-xl border"
          >
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image_url}
                alt=""
                className="h-28 w-full object-cover"
              />
            ) : (
              <div className="bg-muted text-muted-foreground flex h-28 items-center justify-center text-xs">
                No image
              </div>
            )}
            <div className="space-y-1 p-2.5">
              <p className="text-foreground line-clamp-2 text-xs font-medium">
                {productLabel(product)}
              </p>
              <p className="text-muted-foreground text-xs">
                {product.formatted_price}
              </p>
              <span className="border-primary/30 bg-primary/10 text-primary inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium">
                {carousel.button_label}
              </span>
            </div>
          </article>
        ))}
      </div>

      {!carousel.live_ready && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500">
          Preview only — enable Sell on WhatsApp to send this carousel on live
          WhatsApp.
        </p>
      )}
    </div>
  );
}
