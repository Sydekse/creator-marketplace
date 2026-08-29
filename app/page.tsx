import Link from 'next/link';
import {
  ArrowRight,
  CaretDown,
  Check,
  Gear,
  Handshake,
  MagnifyingGlass,
  Megaphone,
  Play,
  Scales,
  SquaresFour,
  Users,
} from '@phosphor-icons/react/dist/ssr';
import { Mark } from '@/components/brand/mark';
import { TikTokIcon } from '@/components/brand/tiktok-icon';
import { Reveal } from '@/components/marketing/reveal';
import { SectionLabel } from '@/components/layout/section-label';
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
    desc: 'Verified creators receive offers that match their niche. Accept or decline. No pressure, no spam.',
  },
  {
    title: 'Deliver & approve',
    desc: 'The creator submits the video. The brand reviews it with engagement data attached. No chasing links.',
  },
  {
    title: 'Approve & pay',
    desc: 'Approval releases the payout. The 15% commission is shown up front, and both sides keep the record.',
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
    desc: 'Verified creators submit videos against the brief, with engagement data attached.',
    active: false,
  },
  {
    title: 'Approve & pay',
    desc: 'Review the deliverable and approve it. The creator is then paid from escrow.',
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
  { value: 'Free', label: 'To join and list your profile' },
  { value: 'On approval', label: 'Your payout is released' },
];

const BRAND_PRICING = [
  'Unlimited campaigns',
  'Escrow-protected payments',
  'Human-verified creators only',
  'Engagement data for each video',
  'Full audit trail on every deal',
];

const CREATOR_PRICING = [
  'Free to join and list',
  'Keep 85% of every deal',
  'Payout after brand approval',
  'Receive offers, not spam',
  'Commission shown before you accept',
];

const FAQ_ITEMS = [
  {
    q: 'How does escrow work?',
    a: 'When a brand funds a campaign, the money is held in escrow for each deal. It stays there until the brand approves the work or opens a dispute. Creators are paid after approval, and both sides can see the transaction record.',
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
    a: 'No. Joining is free for brands and creators. The platform takes 15% from completed deals, and you see the amount before accepting.',
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
  { icon: SquaresFour, label: 'Dashboard', active: true },
  { icon: Megaphone, label: 'Campaigns', active: false },
  { icon: Users, label: 'Creators', active: false },
  { icon: Handshake, label: 'Deals', active: false },
  { icon: Scales, label: 'Disputes', active: false },
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
  { label: 'Approved & paid', meta: 'Pending', done: false },
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

function SectionIntro({
  label,
  title,
  description,
}: {
  label: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Reveal>
        <SectionLabel as="p">{label}</SectionLabel>
      </Reveal>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-x-16">
        <Reveal>
          <h2 className="font-display text-3xl font-medium leading-[1.12] tracking-tight text-neutral-900 text-balance sm:text-4xl lg:text-5xl">
            {title}
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="max-w-[40ch] text-[15px] leading-[1.65] text-neutral-600 lg:pt-2">
            {description}
          </p>
        </Reveal>
      </div>
    </div>
  );
}

function MiniPayout() {
  return (
    <svg viewBox="0 0 320 72" className="h-16 w-full" aria-hidden>
      <path
        d="M0 58 C 40 58, 48 50, 80 46 S 120 40, 160 28 S 220 22, 260 14 S 300 10, 320 8"
        fill="none"
        className="stroke-brand"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <path
        d="M0 58 C 40 58, 48 50, 80 46 S 120 40, 160 28 S 220 22, 260 14 S 300 10, 320 8 L 320 72 L 0 72 Z"
        fill="var(--brand)"
        opacity="0.18"
      />
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
      aria-hidden
      className={cn(
        'overflow-hidden rounded-[24px] border border-neutral-200 bg-white font-sans shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)]',
        className
      )}
    >
      <div className="relative flex items-center border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <span className="flex gap-2" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-[oklch(0.78_0.08_25)] ring-1 ring-black/5" />
          <span className="h-2 w-2 rounded-full bg-[oklch(0.82_0.09_85)] ring-1 ring-black/5" />
          <span className="h-2 w-2 rounded-full bg-[oklch(0.8_0.09_160)] ring-1 ring-black/5" />
        </span>
        <span className="absolute left-1/2 top-1/2 hidden max-w-[70%] -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-[10px] font-medium text-neutral-600 sm:flex">
          <span className="h-2 w-2 shrink-0 rounded-full bg-brand-soft" />
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
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3"
      >
        <div className="pointer-events-auto flex h-14 w-full max-w-6xl items-center justify-between rounded-full border border-neutral-800 bg-neutral-900/95 px-3 shadow-[0_12px_32px_rgba(23,23,23,0.18)] backdrop-blur">
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
                className="nav-underline mx-3 py-2 text-[13px] text-neutral-400 transition-colors duration-300 ease-out hover:text-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
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
        <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-20 lg:min-h-[900px] lg:pt-32 lg:pb-20">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            aria-hidden
            style={{
              backgroundImage:
                'linear-gradient(to right, oklch(0.88 0 0 / 0.3) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.88 0 0 / 0.3) 1px, transparent 1px)',
              backgroundSize: '72px 72px',
              maskImage: 'linear-gradient(to bottom, black, transparent 82%)',
            }}
          />
          <div className="relative mx-auto w-full max-w-[1400px] px-5 sm:px-8 xl:px-12">
            <div className="relative z-[1] max-w-xl lg:ml-[4%] lg:max-w-2xl">
              <div className="animate-rise-in flex items-center gap-3">
                <TikTokIcon className="h-4 w-4 text-neutral-900" />
                <SectionLabel as="p">Built for TikTok campaigns</SectionLabel>
              </div>
              <h1 className="animate-rise-in-1 mt-6 font-display text-[44px] font-medium leading-[1.04] tracking-tight text-neutral-900 sm:mt-8 sm:text-6xl lg:text-[68px] xl:text-[72px]">
                Brands fund.
                <br />
                <em className="not-italic text-brand">Creators deliver.</em>
              </h1>
              <p className="animate-rise-in-2 mt-5 max-w-[48ch] text-base leading-relaxed text-neutral-600 sm:mt-7 sm:text-lg">
                Set the brief, choose verified creators, and pay only for work
                you approve. The money and the deal stay together.
              </p>
              {/* Platform notice removed; CTAs follow the subhead directly */}
              <div className="animate-rise-in-3 mt-6 flex flex-col items-stretch gap-3 sm:mt-9 sm:flex-row sm:items-center">
                <Link
                  href="/sign-up"
                  className="btn-shine inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-neutral-50 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-neutral-800 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  Create free account
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href="#for-creators"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-neutral-50/80 px-7 py-3 text-sm font-medium text-neutral-700 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  See creator benefits
                </Link>
              </div>
              <dl className="animate-rise-in-4 mt-8 grid max-w-xl grid-cols-3 border-y border-neutral-300/80 py-5 sm:mt-10">
                {[
                  ['15%', 'clear commission'],
                  ['85%', 'kept by creators'],
                  ['Free', 'to join'],
                ].map(([value, label], index) => (
                  <div
                    key={label}
                    className={cn(
                      'pr-4',
                      index > 0 && 'border-l border-neutral-300/80 pl-4'
                    )}
                  >
                    <dt className="font-mono text-base font-medium tabular-nums text-neutral-900 sm:text-lg">
                      {value}
                    </dt>
                    <dd className="mt-1 text-[10px] leading-tight tracking-[0.08em] text-neutral-600 uppercase sm:text-[11px]">
                      {label}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="relative mx-auto mt-14 w-full max-w-[1400px] px-5 sm:px-8 lg:absolute lg:inset-x-0 lg:top-48 lg:mt-0 xl:px-12">
            <div className="animate-rise-in-3 relative ml-auto w-full lg:w-[48%] xl:w-[50%]">
              <AppFrame>
                <div className="flex">
                  {/* Sidebar */}
                  <aside className="hidden w-36 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-neutral-50 p-3 sm:flex">
                    <div className="mb-3 flex items-center gap-2 px-2 pt-1">
                      <Mark tone="dark" className="h-5 w-5 rounded-md" />
                      <span className="text-[9px] font-semibold leading-tight text-neutral-900">
                        Creator Marketplace
                      </span>
                    </div>
                    {SIDEBAR.map((item) => (
                      <div
                        key={item.label}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-[11px] transition-colors',
                          item.active
                            ? 'border-brand/20 bg-brand-tint font-medium text-brand-ink'
                            : 'text-neutral-600 hover:border-neutral-200 hover:bg-white'
                        )}
                      >
                        <item.icon
                          className="h-3.5 w-3.5"
                          weight="light"
                          aria-hidden
                        />
                        {item.label}
                      </div>
                    ))}
                    <div className="mt-auto space-y-1 border-t border-neutral-200 pt-3">
                      <div className="flex items-center gap-2 rounded-md px-2 py-2 text-[11px] text-neutral-600">
                        <Gear
                          className="h-3.5 w-3.5"
                          weight="light"
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
                        <p className="text-[13px] font-semibold tracking-tight text-neutral-900">
                          Campaigns
                        </p>
                        <p className="text-[11px] text-neutral-600">
                          6 active &middot; 2 pending
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="hidden items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-600 md:flex">
                          <MagnifyingGlass
                            className="h-3 w-3"
                            weight="light"
                            aria-hidden
                          />
                          Search
                        </span>
                        <span className="rounded-full bg-brand-deep px-3 py-2 text-[10px] font-semibold text-neutral-50 shadow-sm shadow-brand-deep/10">
                          New campaign
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[
                        ['In escrow', '2,400 ETB', 'across 4 deals'],
                        ['Active campaigns', '6', '2 pending'],
                        ['Paid out', '1,150 ETB', 'this month'],
                      ].map(([label, value, sub]) => (
                        <div
                          key={label}
                          className="rounded-md border border-neutral-200 bg-white p-3"
                        >
                          <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-neutral-600 sm:text-[9px]">
                            {label}
                          </p>
                          <p className="mt-2 font-sans text-[12px] font-medium leading-none tabular-nums text-neutral-900 sm:text-[13px]">
                            {value}
                          </p>
                          <p className="mt-1 text-[9px] leading-tight text-neutral-600">
                            {sub}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-hidden rounded-md border border-neutral-200 bg-white sm:block">
                      {CAMPAIGNS.map((c) => (
                        <div
                          key={c.name}
                          className="flex items-center gap-3 border-b border-neutral-200 px-3 py-3 last:border-b-0"
                        >
                          <Avatar
                            initials={c.brand
                              .split(' ')
                              .map((n) => n[0])
                              .join('')}
                            className="h-7 w-7 text-[8px]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10px] font-semibold tracking-tight text-neutral-900 sm:text-[11px]">
                              {c.name}
                            </p>
                            <p className="truncate text-[9px] text-neutral-600 sm:text-[10px]">
                              {c.brand} &middot; {c.videos}
                            </p>
                          </div>
                          <span className="whitespace-nowrap font-sans text-[10px] font-medium tabular-nums text-neutral-800">
                            {c.price}
                          </span>
                          <Chip tone={c.tone} className="text-[9px]">
                            {c.chip}
                          </Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </AppFrame>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  BAND — four value props divided by hairlines                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-y border-neutral-200 bg-neutral-50">
          <div className="mx-auto grid max-w-6xl px-6 sm:grid-cols-2 lg:grid-cols-4">
            {BAND.map((item, index) => (
              <div
                key={item.title}
                className={cn(
                  'border-b border-neutral-200 py-8 sm:px-8 lg:border-b-0 lg:border-l lg:py-12',
                  index % 2 === 0 && 'sm:border-r lg:border-r-0',
                  index === 0 && 'lg:border-l-0 lg:pl-0',
                  index === BAND.length - 1 && 'lg:pr-0'
                )}
              >
                <SectionLabel as="p">{item.title}</SectionLabel>
                <p className="mt-4 text-[13px] leading-relaxed text-neutral-600">
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
            <SectionIntro
              label="How it works"
              title={
                <>
                  From brief to payout
                  <br />
                  <em className="not-italic text-brand">in four steps.</em>
                </>
              }
              description="The brand creates an offer and funds it. The creator accepts, posts the video, and gets paid after approval."
            />

            <Reveal className="mt-16">
              <ol className="divide-y divide-neutral-200 border-y border-neutral-200">
                {STEPS.map((s, i) => (
                  <li
                    key={s.title}
                    className="grid gap-3 py-8 sm:grid-cols-[88px_1fr] sm:gap-6"
                  >
                    <span
                      aria-hidden
                      className="font-display text-4xl font-medium leading-none text-neutral-300"
                    >
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
            <SectionIntro
              label="Why it works"
              title={
                <>
                  One place for the deal,
                  <br />
                  <em className="not-italic text-brand">
                    the work, and the payment.
                  </em>
                </>
              }
              description="Brands can see the brief, creator, deliverable, payment, and deal history in the same workspace. Nothing has to be pieced together from messages and spreadsheets."
            />
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
            <SectionIntro
              label="The brand workspace"
              title={
                <>
                  Create, fund, and review
                  <br />
                  <em className="not-italic text-brand">from one dashboard.</em>
                </>
              }
              description="Set the campaign terms, choose creators, fund each deal, and approve submitted videos from the brand dashboard."
            />

            <div className="mt-16 grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
              {/* Feature list — active item carries the ink border */}
              <Reveal>
                <ul className="space-y-7">
                  {WORKSPACE_FEATURES.map((f) => (
                    <li
                      key={f.title}
                      tabIndex={0}
                      className={cn(
                        'group rounded-r-sm border-l pl-6 transition-colors duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900',
                        f.active
                          ? 'border-brand'
                          : 'border-neutral-200 hover:border-brand/40 focus-visible:border-brand/40'
                      )}
                    >
                      <h3
                        className={cn(
                          'font-display text-lg font-medium leading-snug transition-colors duration-300 ease-out sm:text-xl',
                          f.active
                            ? 'text-brand'
                            : 'text-neutral-900 lg:text-neutral-500 lg:group-hover:text-neutral-900 lg:group-focus-visible:text-neutral-900'
                        )}
                      >
                        {f.title}
                      </h3>
                      <p
                        className={cn(
                          'mt-2 max-w-[44ch] text-sm leading-relaxed transition-all duration-300 ease-out',
                          f.active
                            ? 'text-neutral-600 opacity-100'
                            : 'text-neutral-600 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100'
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
                            <span className="text-[11px] text-neutral-600">
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
                        <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
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
                                  'h-2 w-2 rounded-full',
                                  t.done ? 'bg-brand-soft' : 'bg-neutral-300'
                                )}
                              />
                              <span
                                className={cn(
                                  'text-[11px]',
                                  t.done
                                    ? 'text-neutral-700'
                                    : 'text-neutral-600'
                                )}
                              >
                                {t.label}
                              </span>
                              <span className="ml-auto text-[10px] text-neutral-600">
                                {t.meta}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {/* Pinned footer — desktop-only; the equal-height     */}
                      {/* floor is absorbed by justify-between above it.     */}
                      <div className="hidden items-center justify-between border-t border-neutral-200 pt-3 lg:flex">
                        <span className="text-[11px] text-neutral-600">
                          Escrow-held &middot; auditable
                        </span>
                        <span className="text-[11px] font-medium text-brand-ink">
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
                      <div className="mx-auto grid aspect-[9/16] w-full max-w-[160px] place-items-center rounded-md border border-neutral-200 bg-neutral-100">
                        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-deep">
                          <Play
                            className="ml-0.5 h-3 w-3 text-neutral-50"
                            weight="fill"
                            aria-hidden
                          />
                        </span>
                      </div>
                      <p className="truncate text-center text-[10px] text-neutral-600">
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
                      <p className="text-center text-[10px] text-neutral-600">
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
            <SectionIntro
              label="For creators"
              title={
                <>
                  Get paid for what you
                  <br />
                  <em className="not-italic text-brand">already do.</em>
                </>
              }
              description="Apply once and get verified. Brands can then send offers that match your niche. You see the work, price, and commission before you accept."
            />

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
                      <p className="text-[11px] text-neutral-600">
                        Payouts · last 12 weeks
                      </p>
                      <p className="mt-1 font-display text-2xl font-medium text-neutral-900">
                        38,250 ETB
                      </p>
                    </div>
                    <Chip tone="teal">3 deals approved</Chip>
                  </div>
                  <MiniPayout />
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
                          <p className="text-[10px] text-neutral-600">
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
            <SectionIntro
              label="Pricing"
              title={
                <>
                  Free to join.
                  <br />
                  <em className="not-italic text-brand">
                    15% on completed deals.
                  </em>
                </>
              }
              description="Brands and creators can join without a subscription. The platform takes 15% only when a deal is completed."
            />

            <div className="mx-auto mt-16 grid max-w-4xl overflow-hidden border-y border-neutral-200 md:grid-cols-2 md:divide-x md:divide-neutral-200">
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
                  <div className="flex h-full flex-col px-1 py-10 md:px-10">
                    <p className="text-lg font-semibold text-neutral-900">
                      {card.title}
                    </p>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="font-display text-4xl font-medium tracking-tight text-neutral-900">
                        Free
                      </span>
                      <span className="text-sm text-neutral-600">to join</span>
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
                              weight="light"
                              aria-hidden
                            />
                          </span>
                          {row}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-6 border-t border-neutral-200 pt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-ink">
                        {card.cta}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        Free to join. Choose this account type when you sign up.
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal>
              <p className="mt-8 text-center text-xs text-neutral-600">
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
              <SectionLabel as="p">FAQ</SectionLabel>
              <h2 className="mt-5 font-display text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
                Common questions
              </h2>
            </Reveal>
            <div>
              {FAQ_ITEMS.map((item, i) => (
                <Reveal key={item.q} delay={i * 40}>
                  <details className="faq-item group border-b border-neutral-200 py-6 last:border-b-0">
                    <summary className="flex list-none cursor-pointer items-center justify-between gap-4 text-[15px] font-medium text-neutral-900 transition-colors duration-300 ease-out hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 [&::-webkit-details-marker]:hidden">
                      {item.q}
                      <CaretDown
                        className="h-4 w-4 shrink-0 text-neutral-600 transition-transform duration-300 ease-out group-open:rotate-180"
                        aria-hidden
                      />
                    </summary>
                    <p className="faq-answer mt-3 max-w-[60ch] text-sm leading-relaxed text-neutral-600">
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
                Create your free account.
              </h2>
              <p className="mx-auto mt-5 max-w-[50ch] text-neutral-400">
                Join as a brand or creator. No credit card is required.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  className="btn-shine inline-flex items-center justify-center gap-2 rounded-full bg-neutral-50 px-7 py-3 text-sm font-medium text-neutral-900 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
                >
                  Create free account
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
              Brands find verified TikTok creators, fund deals, review videos,
              and release payment after approval.
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
                  <Link
                    href="/terms"
                    className="rounded-sm transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                  >
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link
                    href="/privacy"
                    className="rounded-sm transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                  >
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-neutral-200">
          <p className="mx-auto max-w-6xl px-6 py-5 text-center text-xs text-neutral-600">
            &copy; {new Date().getFullYear()} Creator Marketplace. All rights
            reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
