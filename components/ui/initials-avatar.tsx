import { cn } from '@/lib/utils';

/**
 * A 2-letter initial avatar using the Bungee display font, with an optional
 * picture on top.
 *
 * Derives initials from the user's name:
 *   - 2+ words → first letter of part[0] + first letter of part[1]  ("Naod Sima" → "NS")
 *   - 1 word   → first two letters                                   ("Naod" → "NA")
 *
 * Always uppercase. No client JS — pure string rendering.
 *
 * When `image` is given, it is layered over the initials with a plain `<img>`
 * (empty `alt`, the name is decoration beside real text everywhere this is
 * used). A URL that fails to load — e.g. an expired TikTok CDN link that a
 * stats refresh has not yet repaired — renders as nothing, so the initials
 * underneath show through: a CSS-only fallback that keeps this a server
 * component.
 */

function getInitials(name: string): string {
  const parts = name.trim().replace(/^@+/, '').split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

const SIZE_CLASSES = {
  sm: 'size-6 rounded-[8px] text-[10px]',
  default: 'size-8 rounded-[10px] text-xs',
  lg: 'size-12 rounded-2xl text-base',
} as const;

export function InitialsAvatar({
  name,
  image,
  size = 'default',
  className,
}: {
  name: string;
  /** Profile picture URL; null/undefined falls back to initials. */
  image?: string | null;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  return (
    <div
      className={cn(
        // The brand-dashboard portrait grammar (bd-pfp): ink square with a
        // proportional radius and light initials. The top-nav trigger opts
        // back into its circle via className.
        'relative flex shrink-0 items-center justify-center overflow-hidden',
        'bg-[oklch(0.22_0.005_220)] text-[#fafafa]',
        'font-[family-name:var(--font-bungee)] font-normal uppercase',
        'select-none',
        SIZE_CLASSES[size],
        className
      )}
      aria-hidden="true"
    >
      {getInitials(name)}
      {image ? (
        // Remote avatar hosts vary (blob store, TikTok CDN interim);
        // next/image would need a remotePatterns entry per host and offers
        // nothing for a 32px circle.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </div>
  );
}
