import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The feedback cycle for bare text links (design.md principle 9: every
 * interactive element gets a hover, a press, and a focus ring).
 *
 * Carries only the feedback — underline draw on hover, opacity press on
 * `:active`, the accent focus ring — and no colour, so each call site keeps its
 * own text colour (muted, brand-ink, on-dark). A text link written without
 * this is a link that keyboard users cannot find and touch users cannot feel;
 * seventeen copies of the same class string would drift, so they share this.
 */
export const textLinkFeedback =
  'rounded-[4px] underline-offset-4 transition-opacity duration-150 hover:underline active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
