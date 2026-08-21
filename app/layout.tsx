import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const dmSans = localFont({
  src: [{ path: '../public/fonts/dm-sans-latin.woff2', weight: '100 900' }],
  variable: '--font-dm-sans',
  display: 'swap',
});

const dmMono = localFont({
  src: [
    { path: '../public/fonts/dm-mono-400-latin.woff2', weight: '400' },
    { path: '../public/fonts/dm-mono-500-latin.woff2', weight: '500' },
  ],
  variable: '--font-dm-mono',
  display: 'swap',
});

/** Editorial serif reserved for landing-page display headlines. */
const notoSerif = localFont({
  src: [{ path: '../public/fonts/noto-serif-latin.woff2', weight: '400 600' }],
  variable: '--font-noto-serif',
  display: 'swap',
});

/** Bold display face for initials avatars. */
const bungee = localFont({
  src: '../public/fonts/bungee-latin.woff2',
  variable: '--font-bungee',
  weight: '400',
  display: 'swap',
});

const SITE_NAME = 'Creator Marketplace';
const SITE_DESCRIPTION =
  'A two-sided marketplace connecting brands with TikTok creators — with escrow-protected payments and verified-only talent.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'),
  title: {
    default: SITE_NAME,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} ${notoSerif.variable} ${bungee.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        {children}
      </body>
    </html>
  );
}
