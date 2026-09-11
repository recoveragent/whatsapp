'use client';

import { ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';
import { useRef } from 'react';

import type { PlaygroundProductCarousel } from '@/lib/ai/playground-carousel';
import { cn } from '@/lib/utils';

function productLabel(product: PlaygroundProductCarousel['products'][number]): string {
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
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <ShoppingBag className="h-3 w-3" />
          Product carousel preview
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => scroll('left')}
            className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted"
            aria-label="Scroll carousel left"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted"
            aria-label="Scroll carousel right"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {carousel.products.map((product) => (
          <article
            key={product.shopify_variant_id}
            className="w-[168px] shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-background"
          >
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image_url}
                alt=""
                className="h-28 w-full object-cover"
              />
            ) : (
              <div className="flex h-28 items-center justify-center bg-muted text-xs text-muted-foreground">
                No image
              </div>
            )}
            <div className="space-y-1 p-2.5">
              <p className="line-clamp-2 text-xs font-medium text-foreground">
                {productLabel(product)}
              </p>
              <p className="text-xs text-muted-foreground">{product.formatted_price}</p>
              <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {carousel.button_label}
              </span>
            </div>
          </article>
        ))}
      </div>

      {!carousel.live_ready && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500">
          Preview only — enable Sell on WhatsApp to send this carousel on live WhatsApp.
        </p>
      )}
    </div>
  );
}
