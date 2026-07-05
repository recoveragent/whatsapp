import Image from 'next/image';

import { cn } from '@/lib/utils';

export const BRAND_NAME = 'Recover Agent';
export const BRAND_LOGO_PATH = '/recover-agent-logo.png';

type BrandLogoProps = {
  className?: string;
  /** Rendered height in pixels; width scales from the asset aspect ratio. */
  height?: number;
  priority?: boolean;
};

export function BrandLogo({
  className,
  height = 32,
  priority = false,
}: BrandLogoProps) {
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
