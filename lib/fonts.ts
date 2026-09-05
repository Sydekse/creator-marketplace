import { JetBrains_Mono, Outfit } from 'next/font/google';

/**
 * The v4 `.bd` design layer's typefaces, declared once so every page that
 * mounts the layer shares a single pair of font instances (one preload, one
 * CSS variable each) instead of forking per-file copies that can drift.
 */
export const bdSans = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bd-sans',
});

export const bdMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-bd-mono',
});
