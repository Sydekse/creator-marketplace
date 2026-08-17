import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Handshake,
  LayoutDashboard,
  Megaphone,
  Play,
  Scale,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { Reveal } from '@/components/marketing/reveal';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Landing page — Creator Marketplace                                        */
/*  Direction: editorial, monochrome. Inspired by the Straton layout:         */
/*  floating pill nav, serif display headlines, hairline dividers, CSS-built  */
/*  app mockups, bordered pricing rows, multi-column footer.                  */
/*  Palette: the Tailwind neutral scale plus one low-saturation teal accent   */
/*  (oklch 0.44 0.11 185) reserved for emphasis phrases, section labels, the  */
/*  active workspace feature, and the in-mockup UI (status chips, primary     */
/*  actions, window chrome). The page frame itself stays strictly monochrome. */
/*  Fonts: Noto Serif (display headlines) + DM Sans (UI + body).              */
/* -------------------------------------------------------------------------- */

const STEPS = [
  {
    title: 'Brief & fund',
    desc: 'A brand sets a budget, picks a niche, and funds the campaign. The money moves to escrow the moment an offer is accepted.',
  },
  {
    title: 'Creators accept',
    desc: 'Verified creators receive offers that match their niche. Accept or decline — no pressure, no spam.',
  },
  {
    title: 'Deliver & approve',
    desc: 'The creator submits the video and the brand reviews it with engagement data attached — no chasing links.',
  },
  {
    title: 'Approve & pay',
    desc: 'Approval releases the payout instantly, net of the transparent 15% commission. Both sides keep the audit trail.',
  },
];

const BAND = [
  {
    title: 'Campaigns',
    desc: 'Brief, fund, and track every deal from one dashboard.',
  },
  {
    title: 'Creators',
    desc: 'Verified profiles matched to your niche, not a cold inbox.',
  },
  {
    title: 'Escrow',
    desc: 'Funds stay locked until you approve the deliverable.',
  },
  {
    title: 'Trust',
    desc: 'A full audit trail and a fair dispute process.',
  },
];

const WORKSPACE_FEATURES = [
  {
    title: 'Brief & fund',
    desc: 'Set a budget, pick a niche, and fund the campaign. Money moves to escrow the moment the offer is accepted.',
    active: true,
  },
  {
    title: 'Creators deliver',
    desc: 'Verified creators submit their video against the brief, with real-time engagement data attached.',
    active: false,
  },
  {
    title: 'Approve & pay',
    desc: 'Review the deliverable, approve, and the creator is paid instantly from escrow.',
    active: false,
  },
  {
    title: 'Disputes, handled',
    desc: 'Flag a deliverable and an admin reviews the case with the full audit trail on record.',
    active: false,
  },
];

const CREATOR_STATS = [
  { value: '85%', label: 'You keep on every approved deal' },
  { value: '0', label: 'Fees to join or list your profile' },
  { value: 'Instant', label: 'Payout the moment a brand approves' },
];

const BRAND_PRICING = [
  'Unlimited campaigns',
  'Escrow-protected payments',
  'Human-verified creators only',
  'Real-time engagement data',
  'Full audit trail on every deal',
];

const CREATOR_PRICING = [
  'Free to join and list',
  'Keep 85% of every deal',
  'Instant payout on approval',
  'Receive offers, not spam',
  'Commission shown before you accept',
];

const FAQ_ITEMS = [
  {
    q: 'How does escrow work?',
    a: 'When a brand funds a campaign, the total is held in escrow per deal. The money stays locked until the brand approves the deliverable — or disputes it. Creators get paid only after approval, and every transaction leaves an audit trail.',
  },
  {
    q: 'How are creators verified?',
    a: 'Every creator submits their TikTok handle. A human reviews it before the creator appears in search. Unverified profiles are completely hidden from brands.',
  },
  {
    q: 'When do I get paid as a creator?',
    a: 'Immediately after a brand approves your deliverable. The payout is net of the platform commission, which is shown before you accept any offer.',
  },
  {
    q: "What if a creator doesn't deliver?",
    a: 'Brands can flag a deal for dispute. An admin reviews the case and can release, refund, or request revision. The escrow ensures the brand never pays for unreviewed work.',
  },
  {
    q: 'Is there a fee to join?',
    a: 'No. Signing up is free for both brands and creators. The platform takes a transparent 15% commission on completed deals — you see the breakdown before accepting.',
  },
];

const CAMPAIGNS = [
  {
    name: 'Ramadan Beauty Push',
    brand: 'Layla H.',
    chip: 'Active',
    tone: 'teal' as const,
    price: '15,000 ETB',
    videos: '3 videos',
  },
  {
    name: 'Fitness January',
    brand: 'Daniel K.',
    chip: 'Pending',
    tone: 'amber' as const,
    price: '8,000 ETB',
    videos: '2 videos',
  },
  {
    name: 'Tech Launch Week',
    brand: 'Sara M.',
    chip: 'Active',
    tone: 'teal' as const,
    price: '22,000 ETB',
    videos: '4 videos',
  },
];

const SIDEBAR = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: Megaphone, label: 'Campaigns', active: false },
  { icon: Users, label: 'Creators', active: false },
  { icon: Handshake, label: 'Deals', active: false },
  { icon: Scale, label: 'Disputes', active: false },
];

const DEAL_ROWS = [
  { label: 'Campaign', value: 'Ramadan Beauty Push' },
  { label: 'Creator', value: 'Layla H.' },
  { label: 'Status', value: 'In progress' },
  { label: 'Total', value: '15,000 ETB' },
  { label: 'Commission (15%)', value: '−2,250 ETB' },
  { label: 'Creator payout', value: '12,750 ETB', strong: true },
];

const TIMELINE = [
  { label: 'Offer accepted', meta: '02 Aug', done: true },
  { label: 'Funded in escrow', meta: '02 Aug', done: true },
  { label: 'Video submitted', meta: '10 Aug', done: true },
  { label: 'Approved & paid', meta: '—', done: false },
];

const CREATOR_DEALS = [
  {
    brand: 'Ramadan Beauty Push',
    creator: 'Layla H.',
    chip: 'Approved',
    amount: '+12,750 ETB',
  },
  {
    brand: 'Fitness January',
    creator: 'Daniel K.',
    chip: 'Pending',
    amount: '+6,800 ETB',
  },
  {
    brand: 'Tech Launch Week',
    creator: 'Sara M.',
    chip: 'Approved',
    amount: '+18,700 ETB',
  },
];

/* -------------------------------------------------------------------------- */
/*  Presentational helpers                                                    */
/* -------------------------------------------------------------------------- */

function Mark({
  tone = 'light',
  className,
}: {
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-lg',
        tone === 'light' ? 'bg-neutral-50' : 'bg-neutral-900',
        className
      )}
    >
      <span className="relative block h-3 w-3">
        <span
          className={cn(
            'absolute left-0 top-0 h-2 w-2 rounded-[4px]',
            tone === 'light' ? 'bg-neutral-900' : 'bg-neutral-50'
          )}
        />
        <span
          className={cn(
            'absolute bottom-0 right-0 h-2 w-2 rounded-[4px]',
            tone === 'light' ? 'bg-neutral-300' : 'bg-neutral-500'
          )}
        />
      </span>
    </span>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

function Avatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-600',
        className
      )}
    >
      {initials}
    </span>
  );
}

function AppFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[24px] border border-neutral-200 bg-white shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)]',
        className
      )}
    >
      <div className="relative flex items-center border-b border-neutral-200 bg-neutral-50 px-4 py-2">
        <span className="flex gap-2" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-[oklch(0.78_0.08_25)]" />
          <span className="h-2 w-2 rounded-full bg-[oklch(0.82_0.09_85)]" />
          <span className="h-2 w-2 rounded-full bg-[oklch(0.8_0.09_160)]" />
        </span>
        <span className="absolute left-1/2 top-1/2 hidden max-w-[70%] -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] text-neutral-500 sm:flex">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-soft" />
          <span className="truncate">creator-marketplace.et</span>
        </span>
        <span className="ml-auto w-14" aria-hidden />
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function HomePage() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
      {/* ------------------------------------------------------------------ */}
      {/*  NAV — floating pill, dark on light                               */}
      {/* ------------------------------------------------------------------ */}
      <nav
        aria-label="Primary"
        className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4"
      >
        <div className="pointer-events-auto flex h-12 w-full max-w-[880px] items-center justify-between rounded-full border border-neutral-800 bg-neutral-900/95 pl-3 pr-2 shadow-[0_12px_32px_rgba(23,23,23,0.18)] backdrop-blur">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
          >
            <Mark />
            <span className="text-[13px] font-semibold tracking-tight text-neutral-50">
              Creator Marketplace
            </span>
          </Link>
          <div className="hidden items-center gap-1 lg:flex">
            {[
              ['How it works', '#how-it-works'],
              ['For brands', '#for-brands'],
              ['For creators', '#for-creators'],
              ['Pricing', '#pricing'],
              ['FAQ', '#faq'],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="rounded-full px-3 py-2 text-[13px] text-neutral-400 transition-colors duration-300 ease-out hover:bg-white/5 hover:text-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sign-in"
              className="hidden rounded-full px-3 py-2 text-[13px] text-neutral-400 transition-colors duration-300 ease-out hover:text-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="btn-shine rounded-full bg-neutral-50 px-4 py-2 text-[13px] font-medium text-neutral-900 transition-all duration-300 ease-out hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <main>
        {/* ---------------------------------------------------------------- */}
        {/*  HERO — editorial headline over a CSS-built dashboard mockup     */}
        {/* ---------------------------------------------------------------- */}
        <section className="pt-24 pb-16 sm:pt-28 sm:pb-20">
          <div className="mx-auto max-w-5xl px-6 text-center">
            <h1 className="animate-rise-in font-display text-5xl font-medium leading-[1.08] tracking-tight text-neutral-900 sm:text-6xl lg:text-[72px]">
              Brands fund.
              <br />
              <em className="not-italic text-brand">Creators deliver.</em>
            </h1>{' '}
            <p className="animate-rise-in-1 mx-auto mt-6 max-w-[52ch] text-base leading-relaxed text-neutral-600 sm:text-lg">
              Brief a campaign, fund it in escrow, and pay for deliverables you
              actually approve.
            </p>
            {/* Platform notice — shimmering pill, just above the CTAs      */}
            <div className="animate-rise-in-2 mt-8 flex justify-center">
              <div className="shimmer-border p-px">
                <p className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs text-neutral-600">
                  <TikTokIcon className="h-3.5 w-3.5 text-neutral-900" />
                  TikTok only for now &mdash; more platforms coming soon
                </p>
              </div>
            </div>
            <div className="animate-rise-in-3 mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="btn-shine inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-neutral-50 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-neutral-800 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                Create an account
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 px-7 py-3 text-sm font-medium text-neutral-700 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-500 hover:text-neutral-900 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                See how it works
              </Link>
            </div>
            <p className="animate-rise-in-4 mt-4 text-xs text-neutral-500">
              Free to join &middot; 15% transparent commission &middot; Pay only
              when a deal completes
            </p>
          </div>

          <div className="animate-rise-in-4 mx-auto mt-6 max-w-5xl px-6 sm:mt-8">
            <AppFrame>
              <div className="flex">
                {/* Sidebar */}
                <aside className="hidden w-44 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-neutral-50 p-3 sm:flex">
                  <div className="mb-2 flex items-center gap-2 px-2 pt-1">
                    <Mark tone="dark" className="h-5 w-5 rounded-md" />
                    <span className="text-[10px] font-semibold text-neutral-900">
                      Creator Marketplace
                    </span>
                  </div>
                  {SIDEBAR.map((item) => (
                    <div
                      key={item.label}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-2 text-[11px]',
                        item.active
                          ? 'bg-brand-strong font-medium text-neutral-50'
                          : 'text-neutral-600'
                      )}
                    >
                      <item.icon
                        className="h-3.5 w-3.5"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                      {item.label}
                    </div>
                  ))}
                  <div className="mt-auto space-y-1 border-t border-neutral-200 pt-3">
                    <div className="flex items-center gap-2 rounded-md px-2 py-2 text-[11px] text-neutral-600">
                      <Settings
                        className="h-3.5 w-3.5"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                      Settings
                    </div>
                    <div className="flex items-center gap-2 px-2 py-2">
                      <Avatar initials="AD" className="h-6 w-6 text-[8px]" />
                      <span className="text-[10px] font-medium text-neutral-700">
                        Admin
                      </span>
                    </div>
                  </div>
                </aside>

                {/* Main panel */}
                <div className="min-w-0 flex-1 space-y-4 bg-neutral-50 p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">
                        Campaigns
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        6 active &middot; 2 pending
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="hidden items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-500 md:flex">
                        <Search
                          className="h-3 w-3"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        Search campaigns
                      </span>
                      <span className="rounded-full bg-brand-deep px-3 py-2 text-[11px] font-medium text-neutral-50">
                        New campaign
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {[
                      ['In escrow', '2,400 ETB', 'across 4 deals'],
                      ['Active campaigns', '6', '2 pending'],
                      ['Paid out', '1,150 ETB', 'this month'],
                    ].map(([label, value, sub]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-neutral-200 bg-white p-3"
                      >
                        <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                          {label}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-neutral-900">
                          {value}
                        </p>
                        <p className="text-[10px] text-neutral-500">{sub}</p>
                      </div>
                    ))}
                  </div>

                  <div className="hidden gap-3 sm:grid sm:grid-cols-3">
                    {CAMPAIGNS.map((c) => (
                      <div
                        key={c.name}
                        className="rounded-xl border border-neutral-200 bg-white p-3"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar
                            initials={c.brand
                              .split(' ')
                              .map((n) => n[0])
                              .join('')}
                            className="h-7 w-7 text-[9px]"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-medium text-neutral-900">
                              {c.name}
                            </p>
                            <p className="truncate text-[10px] text-neutral-500">
                              {c.brand} &middot; {c.videos}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2">
                          <span className="text-[11px] font-semibold text-neutral-900">
                            {c.price}
                          </span>
                          <Chip tone={c.tone} className="text-[10px]">
                            {c.chip}
                          </Chip>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </AppFrame>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  BAND — four value props divided by hairlines                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-y border-neutral-200 bg-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {BAND.map((item) => (
              <div
                key={item.title}
                className="lg:border-l lg:border-neutral-200 lg:px-8 lg:first:border-l-0 lg:first:pl-0"
              >
                <p className="text-[15px] font-semibold text-neutral-900">
                  {item.title}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  HOW IT WORKS — numbered steps, hairline-divided                  */}
        {/* ---------------------------------------------------------------- */}
        <section id="how-it-works" className="scroll-mt-28 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-8 lg:grid-cols-2">
              <Reveal>
                <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
                  How it works
                </p>
                <h2 className="mt-5 font-display text-3xl font-medium leading-[1.12] tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
                  From brief to payout
                  <br />
                  <em className="not-italic text-brand">in four steps.</em>
                </h2>
              </Reveal>
              <Reveal delay={120} className="lg:self-end">
                <p className="max-w-[52ch] text-base leading-relaxed text-neutral-600 sm:text-lg">
                  A deal is a single thread from first offer to final payout —
                  escrow holds the money, and every step is on the record.
                </p>
              </Reveal>
            </div>

            <Reveal className="mt-16">
              <ol className="divide-y divide-neutral-200 border-y border-neutral-200">
                {STEPS.map((s, i) => (
                  <li
                    key={s.title}
                    className="grid gap-3 py-8 sm:grid-cols-[88px_1fr] sm:gap-6"
                  >
                    <span className="font-display text-4xl font-medium leading-none text-neutral-300">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-neutral-900">
                        {s.title}
                      </h3>
                      <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-neutral-600">
                        {s.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  WHY — label + serif headline + right-aligned description         */}
        {/* ---------------------------------------------------------------- */}
        <section id="platform" className="scroll-mt-28 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-8 lg:grid-cols-2">
              <Reveal>
                <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
                  Why it works
                </p>
                <h2 className="mt-5 font-display text-3xl font-medium leading-[1.12] tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
                  Replace the patchwork,
                  <br />
                  <em className="not-italic text-brand">not your process.</em>
                </h2>
              </Reveal>
              <Reveal delay={120} className="lg:self-end">
                <p className="max-w-[52ch] text-base leading-relaxed text-neutral-600 sm:text-lg">
                  Briefs in one tool. Payments in another. Conversations
                  somewhere else. Creator Marketplace keeps the deal and the
                  money together — so every review starts from what was agreed,
                  not what got lost between tabs.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  BRAND WORKSPACE — feature list + stacked app frames              */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="for-brands"
          className="scroll-mt-28 border-t border-neutral-200 py-24 sm:py-32"
        >
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-8 lg:grid-cols-2">
              <Reveal>
                <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
                  The brand workspace
                </p>
                <h2 className="mt-5 font-display text-3xl font-medium leading-[1.12] tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
                  Run the campaign in
                  <br />
                  <em className="not-italic text-brand">one workspace.</em>
                </h2>
              </Reveal>
              <Reveal delay={120} className="lg:self-end">
                <p className="max-w-[52ch] text-base leading-relaxed text-neutral-600 sm:text-lg">
                  Brief a campaign, fund it in escrow, and review deliverables
                  without switching tabs. Less switching, no lost context.
                </p>
              </Reveal>
            </div>

            <div className="mt-16 grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
              {/* Feature list — active item carries the ink border */}
              <Reveal>
                <ul className="space-y-7">
                  {WORKSPACE_FEATURES.map((f) => (
                    <li
                      key={f.title}
                      className={cn(
                        'group border-l pl-6 transition-colors duration-300 ease-out',
                        f.active
                          ? 'border-brand'
                          : 'border-neutral-200 hover:border-brand/40'
                      )}
                    >
                      <h3
                        className={cn(
                          'font-display text-lg font-medium leading-snug transition-colors duration-300 ease-out sm:text-xl',
                          f.active
                            ? 'text-brand'
                            : 'text-neutral-500 group-hover:text-neutral-900'
                        )}
                      >
                        {f.title}
                      </h3>
                      <p
                        className={cn(
                          'mt-2 max-w-[44ch] text-sm leading-relaxed transition-all duration-300 ease-out',
                          f.active
                            ? 'text-neutral-600 opacity-100'
                            : 'text-neutral-600 opacity-0 group-hover:opacity-100'
                        )}
                      >
                        {f.desc}
                      </p>
                    </li>
                  ))}
                </ul>
              </Reveal>

              {/* Frames — deal overview beside the deliverable, matched in  */}
              {/* size; the 9:16 ratio belongs to the video, not the frame.  */}
              {/* Equal height via an explicit min-h floor (never clips —    */}
              {/* content only grows the box) + h-full so the footer pins.   */}
              <div className="grid items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
                <Reveal delay={80}>
                  <AppFrame>
                    <div className="flex flex-col space-y-4 bg-neutral-50 p-4 sm:p-5 lg:min-h-[478px] lg:justify-between">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-neutral-900">
                          Deal overview
                        </p>
                        <Chip tone="teal">Funded</Chip>
                      </div>
                      <div className="divide-y divide-neutral-200 border-y border-neutral-200">
                        {DEAL_ROWS.map((row) => (
                          <div
                            key={row.label}
                            className="flex items-center justify-between py-2"
                          >
                            <span className="text-[11px] text-neutral-500">
                              {row.label}
                            </span>
                            <span
                              className={cn(
                                'text-[11px]',
                                row.strong
                                  ? 'font-semibold text-neutral-900'
                                  : 'font-medium text-neutral-700'
                              )}
                            >
                              {row.value}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                          Timeline
                        </p>
                        <ul className="mt-3 space-y-3">
                          {TIMELINE.map((t) => (
                            <li
                              key={t.label}
                              className="flex items-center gap-3"
                            >
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  t.done ? 'bg-brand-soft' : 'bg-neutral-300'
                                )}
                              />
                              <span
                                className={cn(
                                  'text-[11px]',
                                  t.done
                                    ? 'text-neutral-700'
                                    : 'text-neutral-500'
                                )}
                              >
                                {t.label}
                              </span>
                              <span className="ml-auto text-[10px] text-neutral-500">
                                {t.meta}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {/* Pinned footer — desktop-only; the equal-height     */}
                      {/* floor is absorbed by justify-between above it.     */}
                      <div className="hidden items-center justify-between border-t border-neutral-200 pt-3 lg:flex">
                        <span className="text-[11px] text-neutral-500">
                          Escrow-held &middot; auditable
                        </span>
                        <span className="text-[11px] font-medium text-brand">
                          View audit trail &rarr;
                        </span>
                      </div>
                    </div>
                  </AppFrame>
                </Reveal>

                <Reveal delay={160}>
                  <AppFrame>
                    <div className="flex flex-col space-y-4 bg-neutral-50 p-4 sm:p-5 lg:min-h-[478px] lg:justify-between">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-neutral-900">
                          Deliverable
                        </p>
                        <Chip tone="gray">1 of 1 video</Chip>
                      </div>
                      <div className="mx-auto grid aspect-[9/16] w-full max-w-[160px] place-items-center rounded-lg border border-neutral-200 bg-neutral-100">
                        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-deep">
                          <Play
                            className="ml-0.5 h-3 w-3 fill-white text-white"
                            aria-hidden
                          />
                        </span>
                      </div>
                      <p className="truncate text-center text-[10px] text-neutral-500">
                        tiktok.com/@laylah/posts/84
                      </p>
                      <div className="flex gap-2">
                        <span className="flex-1 rounded-full bg-brand-deep px-4 py-2 text-center text-[11px] font-medium text-neutral-50">
                          Approve &amp; pay
                        </span>
                        <span className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-center text-[11px] font-medium text-neutral-600">
                          Flag for review
                        </span>
                      </div>
                      <p className="text-center text-[10px] text-neutral-500">
                        12,750 ETB releases to the creator on approval.
                      </p>
                    </div>
                  </AppFrame>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  CREATORS — stats band + creator app frame                        */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="for-creators"
          className="scroll-mt-28 border-t border-neutral-200 py-24 sm:py-32"
        >
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-8 lg:grid-cols-2">
              <Reveal>
                <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
                  For creators
                </p>
                <h2 className="mt-5 font-display text-3xl font-medium leading-[1.12] tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
                  Get paid for what you
                  <br />
                  <em className="not-italic text-brand">already do.</em>
                </h2>
              </Reveal>
              <Reveal delay={120} className="lg:self-end">
                <p className="max-w-[52ch] text-base leading-relaxed text-neutral-600 sm:text-lg">
                  Apply once, get verified, and receive offers that match your
                  niche — no cold DMs, no chasing invoices. The commission is
                  shown before you accept, never after.
                </p>
              </Reveal>
            </div>

            <Reveal delay={80}>
              <div className="mt-16 grid gap-8 border-y border-neutral-200 py-10 sm:grid-cols-3 sm:gap-0">
                {CREATOR_STATS.map((s, i) => (
                  <div
                    key={s.label}
                    className={cn(
                      'sm:border-l sm:border-neutral-200 sm:px-10',
                      i === 0 && 'sm:border-l-0 sm:pl-0'
                    )}
                  >
                    <p className="font-display text-3xl font-medium text-neutral-900 sm:text-4xl">
                      {s.value}
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={120} className="mt-12">
              <AppFrame className="mx-auto max-w-4xl">
                <div className="space-y-4 bg-neutral-50 p-4 sm:p-6">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] text-neutral-500">This month</p>
                      <p className="mt-1 font-display text-2xl font-medium text-neutral-900">
                        38,250 ETB
                      </p>
                    </div>
                    <Chip tone="teal">3 deals approved</Chip>
                  </div>
                  <div className="divide-y divide-neutral-200 border-y border-neutral-200">
                    {CREATOR_DEALS.map((d) => (
                      <div
                        key={d.brand}
                        className="flex items-center gap-3 py-3"
                      >
                        <Avatar
                          initials={d.creator
                            .split(' ')
                            .map((n) => n[0])
                            .join('')}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-medium text-neutral-900">
                            {d.brand}
                          </p>
                          <p className="text-[10px] text-neutral-500">
                            {d.creator}
                          </p>
                        </div>
                        <Chip
                          tone={d.chip === 'Approved' ? 'teal' : 'amber'}
                          className="hidden sm:inline-flex"
                        >
                          {d.chip}
                        </Chip>
                        <span className="text-[11px] font-semibold text-neutral-900">
                          {d.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </AppFrame>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  PRICING — commission model as bordered cards                     */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="pricing"
          className="scroll-mt-28 border-t border-neutral-200 py-24 sm:py-32"
        >
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-8 lg:grid-cols-2">
              <Reveal>
                <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
                  Pricing
                </p>
                <h2 className="mt-5 font-display text-3xl font-medium leading-[1.12] tracking-tight text-neutral-900 sm:text-4xl lg:text-5xl">
                  No subscription.
                  <br />
                  <em className="not-italic text-brand">
                    One transparent fee.
                  </em>
                </h2>
              </Reveal>
              <Reveal delay={120} className="lg:self-end">
                <p className="max-w-[52ch] text-base leading-relaxed text-neutral-600 sm:text-lg">
                  Joining is free for both sides. The platform takes a flat 15%
                  commission on completed deals — shown before you accept, never
                  after.
                </p>
              </Reveal>
            </div>

            <div className="mx-auto mt-16 grid max-w-4xl gap-6 md:grid-cols-2">
              {[
                {
                  title: 'For brands',
                  cta: 'Create a brand account',
                  rows: BRAND_PRICING,
                },
                {
                  title: 'For creators',
                  cta: 'Create a creator account',
                  rows: CREATOR_PRICING,
                },
              ].map((card, i) => (
                <Reveal key={card.title} delay={i * 100}>
                  <div className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-neutral-100 p-8 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-300">
                    <p className="text-lg font-semibold text-neutral-900">
                      {card.title}
                    </p>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-4xl font-semibold tracking-tight text-neutral-900">
                        $0
                      </span>
                      <span className="text-sm text-neutral-600">/ month</span>
                    </div>
                    <p className="mt-2 text-[13px] text-neutral-600">
                      No card required. No plans to pick.
                    </p>
                    <ul className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200">
                      {card.rows.map((row) => (
                        <li
                          key={row}
                          className="flex items-center gap-3 py-3 text-[13px] text-neutral-800"
                        >
                          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-neutral-500">
                            <Check
                              className="h-3 w-3"
                              strokeWidth={1.5}
                              aria-hidden
                            />
                          </span>
                          {row}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href="/sign-up"
                      className="btn-shine mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-neutral-50 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-neutral-800 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                    >
                      {card.cta}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal>
              <p className="mt-8 text-center text-xs text-neutral-500">
                15% platform commission on completed deals. No hidden fees, no
                monthly plans.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  FAQ                                                              */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="faq"
          className="scroll-mt-28 border-t border-neutral-200 py-24 sm:py-32"
        >
          <div className="mx-auto max-w-3xl px-6">
            <Reveal className="mb-14">
              <h2 className="font-display text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
                Questions answered
              </h2>
            </Reveal>
            <div>
              {FAQ_ITEMS.map((item, i) => (
                <Reveal key={item.q} delay={i * 40}>
                  <details className="group border-b border-neutral-200 py-6 last:border-b-0">
                    <summary className="flex list-none cursor-pointer items-center justify-between gap-4 text-[15px] font-medium text-neutral-900 transition-colors duration-300 ease-out hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 [&::-webkit-details-marker]:hidden">
                      {item.q}
                      <ChevronDown
                        className="h-4 w-4 shrink-0 text-neutral-500 transition-transform duration-300 ease-out group-open:rotate-180"
                        aria-hidden
                      />
                    </summary>
                    <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-neutral-600">
                      {item.a}
                    </p>
                  </details>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  FINAL CTA — dark rounded panel                                   */}
        {/* ---------------------------------------------------------------- */}
        <section className="pb-24 sm:pb-32">
          <Reveal className="mx-auto max-w-5xl px-6">
            <div className="rounded-[32px] bg-neutral-900 px-6 py-20 text-center sm:py-24">
              <h2 className="font-display text-4xl font-medium tracking-tight text-neutral-50 sm:text-5xl">
                Start with a free account.
              </h2>
              <p className="mx-auto mt-5 max-w-[50ch] text-neutral-400">
                No credit card required. Sign up as a brand or creator and run
                your first campaign in minutes.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  className="btn-shine inline-flex items-center justify-center gap-2 rounded-full bg-neutral-50 px-7 py-3 text-sm font-medium text-neutral-900 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
                >
                  Create your account
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-50/20 px-7 py-3 text-sm font-medium text-neutral-300 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-50/40 hover:text-neutral-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
                >
                  Sign in
                </Link>
              </div>
              <p className="mt-8 text-xs text-neutral-400">
                Free to join &middot; 15% commission on completed deals only
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/*  FOOTER — multi-column, hairline-divided                           */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.4fr_2fr]">
          <div className="max-w-xs">
            <div className="flex items-center gap-3">
              <Mark tone="dark" />
              <span className="text-sm font-semibold tracking-tight text-neutral-900">
                Creator Marketplace
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-neutral-600">
              A two-sided marketplace connecting brands with TikTok creators —
              with escrow-protected payments and verified-only talent.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <div>
              <p className="mb-3 text-[13px] font-semibold text-neutral-900">
                Product
              </p>
              <ul className="space-y-3 text-[13px] text-neutral-600">
                {[
                  ['How it works', '#how-it-works'],
                  ['For brands', '#for-brands'],
                  ['For creators', '#for-creators'],
                  ['Pricing', '#pricing'],
                  ['FAQ', '#faq'],
                ].map(([label, href]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="rounded-sm transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-neutral-900">
                Resources
              </p>
              <ul className="space-y-3 text-[13px] text-neutral-600">
                <li>
                  <Link
                    href="/sign-in"
                    className="rounded-sm transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                  >
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link
                    href="/sign-up"
                    className="rounded-sm transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                  >
                    Create account
                  </Link>
                </li>
                <li>
                  <span className="cursor-not-allowed opacity-40">Support</span>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-neutral-900">
                Company
              </p>
              <ul className="space-y-3 text-[13px] text-neutral-600">
                <li>
                  <span className="cursor-not-allowed opacity-40">About</span>
                </li>
                <li>
                  <span className="cursor-not-allowed opacity-40">Blog</span>
                </li>
                <li>
                  <span className="cursor-not-allowed opacity-40">Contact</span>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-neutral-900">
                Legal
              </p>
              <ul className="space-y-3 text-[13px] text-neutral-600">
                <li>
                  <span className="cursor-not-allowed opacity-40">
                    Terms of Service
                  </span>
                </li>
                <li>
                  <span className="cursor-not-allowed opacity-40">
                    Privacy Policy
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-neutral-200">
          <p className="mx-auto max-w-6xl px-6 py-5 text-center text-xs text-neutral-500">
            &copy; {new Date().getFullYear()} Creator Marketplace. All rights
            reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
