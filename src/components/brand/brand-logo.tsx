import Image from 'next/image';

import { cn } from '@/lib/utils';

export const BRAND_NAME = 'Recover Agent';
export const BRAND_LOGO_PATH = '/recover-agent-logo.png';
/** Square 1:1 mark — favicon, app icon, compact surfaces. */
export const BRAND_ICON_PATH = '/recover-agent-icon.png';

const LOGO_ASSET_SIZE = 1024;

type BrandLogoProps = {
  className?: string;
  /** Rendered height in pixels; width scales from the asset aspect ratio. */
  height?: number;
  priority?: boolean;
  /** Fills the sidebar header row (full width, ~40px tall). */
  variant?: 'default' | 'sidebar';
};

export function BrandLogo({
  className,
  height = 32,
  priority = false,
  variant = 'default',
}: BrandLogoProps) {
  if (variant === 'sidebar') {
    return (
      <Image
        src={BRAND_LOGO_PATH}
        alt={BRAND_NAME}
        width={LOGO_ASSET_SIZE}
        height={LOGO_ASSET_SIZE}
        sizes="(min-width: 1024px) 208px, 224px"
        className={cn(
          'h-12 w-full max-h-12 object-contain object-left',
          className,
        )}
        priority={priority}
      />
    );
  }

  return (
    <Image
      src={BRAND_LOGO_PATH}
      alt={BRAND_NAME}
      width={Math.round(height * 3.2)}
      height={height}
      className={cn('h-auto w-auto max-w-full object-contain object-left', className)}
      style={{ maxHeight: height }}
      priority={priority}
    />
  );
}

/** Centered logo for auth cards and marketing surfaces. */
export function BrandLogoMark({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-center', className)}>
      <BrandLogo height={44} priority />
    </div>
  );
}
