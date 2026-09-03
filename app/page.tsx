import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CaretDown, Check } from '@phosphor-icons/react/dist/ssr';
import { Mark } from '@/components/brand/mark';
import { TikTokIcon } from '@/components/brand/tiktok-icon';
import { Reveal } from '@/components/marketing/reveal';
import { SectionLabel } from '@/components/layout/section-label';

/** The landing page's SectionLabel, pill chrome stripped â€” bare teal eyebrow text. */
const FLAT_LABEL = 'rounded-none bg-transparent px-0 py-0 shadow-none';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Landing page â€” Creator Marketplace                                        */
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

const BRAND_PRICING = [
  'Unlimited campaigns',
  'Escrow-protected payments',
  'Human-verified creators only',
  'Engagement data for each video',
  'Full audit trail on every deal',
];

const CREATOR_PRICING = [
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

/* -------------------------------------------------------------------------- */
/*  Presentational helpers                                                    */
/* -------------------------------------------------------------------------- */

function SectionIntro({
  label,
  title,
}: {
  label: React.ReactNode;
  title: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* The workspace's chapter ruler: label Â· hairline. */}
      <Reveal>
        <div className="flex items-center gap-4">
          <SectionLabel as="p" className={FLAT_LABEL}>
            {label}
          </SectionLabel>
          <span aria-hidden className="h-px flex-1 bg-neutral-200" />
        </div>
      </Reveal>
      <Reveal>
        <h2 className="font-display text-3xl font-medium leading-[1.12] tracking-tight text-neutral-900 text-balance sm:text-4xl lg:text-5xl">
          {title}
        </h2>
      </Reveal>
    </div>
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
        // The hero's bezel grammar: white rim, hard teal plate behind,
        // pressing toward it on hover (radii concentric: 28 − 12 = 16).
        'hero-plate overflow-hidden rounded-[28px] border border-[oklch(0.79_0.004_220)] bg-white p-3',
        className
      )}
    >
      <div className="overflow-hidden rounded-2xl border border-neutral-200">
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
      {/*  NAV â€” floating pill, dark on light                               */}
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
        {/*  HERO â€” editorial headline beside the real dashboard, cropped    */}
        {/*  by the viewport edge the way the reference frames its product.  */}
        {/* ---------------------------------------------------------------- */}
        <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-20 lg:min-h-[calc((100vw-36rem)*0.7472+336px)] lg:pt-32 lg:pb-0">
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
          <div className="pointer-events-none relative z-[1] w-full px-5 sm:px-9">
            <div className="pointer-events-auto relative max-w-xl lg:max-w-[36rem] lg:origin-top-left lg:scale-[0.88] lg:pt-40">
              <div className="animate-rise-in flex items-center gap-3">
                <TikTokIcon className="h-4 w-4 text-neutral-900" />
                <SectionLabel as="p" className={FLAT_LABEL}>
                  Built for TikTok campaigns
                </SectionLabel>
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
                      'group pr-4 transition-transform duration-300 ease-out hover:-translate-y-0.5',
                      index > 0 && 'border-l border-neutral-300/80 pl-4'
                    )}
                  >
                    <dt className="font-mono text-base font-medium tabular-nums text-neutral-900 transition-colors duration-300 ease-out group-hover:text-brand sm:text-lg">
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

          {/* The product itself, cropped by the viewport the way the deal
              rail crops a long list: the populated brand dashboard in a
              bezeled v4 frame, anchored to the right edge and running past
              it. The bezel is a padded white rim; the shot carries its own
              hairline and a concentric inner radius (28 âˆ’ 12 = 16). */}
          <div className="relative mt-14 lg:absolute lg:top-40 lg:-right-24 lg:left-[42rem] lg:mt-0">
            <div className="hero-frame-wrap relative h-full motion-reduce:animate-none">
              <div className="relative mx-6 h-full sm:mx-9 lg:mx-0">
                <div
                  aria-hidden
                  className="hero-plate h-full overflow-hidden rounded-[28px] border border-[oklch(0.79_0.004_220)] bg-white p-3"
                >
                  <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200">
                    {/* The same window chrome the section frames wear. */}
                    <div className="relative flex shrink-0 items-center border-b border-neutral-200 bg-neutral-50 px-4 py-3">
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
                    <div className="min-h-0 flex-1">
                      <Image
                        src="/marketing/brand-dashboard.png"
                        alt=""
                        width={2880}
                        height={2152}
                        priority
                        // Lossless 2x captures, served as-is: the optimizer's
                        // WebP re-encode softens the UI text these shots exist
                        // to show off.
                        unoptimized
                        className="h-auto w-full"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  HOW IT WORKS â€” numbered steps, hairline-divided                  */}
        {/* ---------------------------------------------------------------- */}
        <section id="how-it-works" className="scroll-mt-28 py-16 sm:py-20">
          <div className="w-full px-5 sm:px-9 [--step-run:0px] lg:[--step-run:8rem] xl:[--step-run:10rem]">
            <SectionIntro
              label="How it works"
              title={
                <>
                  From brief to payout
                  <br />
                  <em className="not-italic text-brand">in four steps.</em>
                </>
              }
            />

            {/* The four steps as the deal's own timeline: one horizontal
                rail running full width — the same grammar as the progress
                rail inside the product — with stations alternating above
                and below the line. */}
            <Reveal className="mt-20 hidden lg:block">
              <div className="relative">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-brand via-brand/35 to-neutral-200"
                />
                <ol className="grid grid-cols-4 gap-x-10">
                  {STEPS.map((s, i) => {
                    const above = i % 2 === 0;
                    return (
                      <li key={s.title} className="group relative h-[26rem]">
                        {/* Station node, seated on the rail. */}
                        <span
                          aria-hidden
                          className={cn(
                            'absolute top-1/2 left-0 z-[1] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border font-mono text-[11px] font-medium tabular-nums transition-all duration-300 ease-out',
                            i === 0
                              ? 'node-breathe border-brand bg-brand text-neutral-50 shadow-[0_0_0_4px_oklch(0.51_0.11_185/0.15)]'
                              : 'border-[oklch(0.79_0.004_220)] bg-white text-neutral-600 group-hover:border-brand group-hover:text-brand group-hover:shadow-[0_0_0_4px_oklch(0.51_0.11_185/0.1)]'
                          )}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {/* Tick joining the node to its caption. */}
                        <span
                          aria-hidden
                          className={cn(
                            'absolute left-5 w-px bg-neutral-200 transition-colors duration-300 ease-out group-hover:bg-brand/40',
                            above
                              ? 'bottom-[calc(50%+1.5rem)] h-9'
                              : 'top-[calc(50%+1.5rem)] h-9'
                          )}
                        />
                        <div
                          className={cn(
                            'absolute inset-x-0 pr-2 transition-transform duration-300 ease-out group-hover:-translate-y-0.5',
                            above
                              ? 'bottom-[calc(50%+4rem)]'
                              : 'top-[calc(50%+4rem)]'
                          )}
                        >
                          <h3 className="font-display text-lg font-medium leading-snug text-neutral-900 transition-colors duration-300 ease-out group-hover:text-brand-ink sm:text-xl">
                            {s.title}
                          </h3>
                          <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-neutral-600">
                            {s.desc}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </Reveal>
            {/* Below lg the timeline stands upright: the same stations on a
                vertical rail. */}
            <Reveal className="mt-16 lg:hidden">
              <ol>
                {STEPS.map((s, i) => (
                  <li
                    key={s.title}
                    className="group relative flex gap-5 pb-9 last:pb-0 sm:gap-6"
                  >
                    <div className="flex flex-col items-center">
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-medium tabular-nums',
                          i === 0
                            ? 'node-breathe border-brand bg-brand text-neutral-50 shadow-[0_0_0_4px_oklch(0.51_0.11_185/0.15)]'
                            : 'border-[oklch(0.79_0.004_220)] bg-white text-neutral-600'
                        )}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {i < STEPS.length - 1 && (
                        <span
                          aria-hidden
                          className="mt-2 w-px flex-1 bg-neutral-200"
                        />
                      )}
                    </div>
                    <div className="pt-1.5">
                      <h3 className="font-display text-lg font-medium leading-snug text-neutral-900">
                        {s.title}
                      </h3>
                      <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-neutral-600">
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
        {/*  WHY â€” label + serif headline + right-aligned description         */}
        {/* ---------------------------------------------------------------- */}
        <section id="platform" className="scroll-mt-28 py-16 sm:py-20">
          <div className="w-full px-5 sm:px-9">
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
            />
            {/* The record itself: everything the deal carries, chained on one
                hairline. A pulse walks the chain, token by token. */}
            <Reveal className="mt-14">
              {/* Mobile: the record as one framed line — tokens chained by
                  arrows, the teal wash walking the sentence. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl border border-[oklch(0.79_0.004_220)] bg-white px-4 py-3.5 shadow-[0_2px_0_rgba(23,23,23,0.07)] sm:hidden">
                {['Brief', 'Creator', 'Deliverable', 'Payment', 'History'].map(
                  (token, i, arr) => (
                    <span
                      key={token}
                      className="inline-flex items-center gap-2"
                    >
                      <span
                        className="chain-token rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-neutral-600"
                        style={{ '--chain-i': i } as React.CSSProperties}
                      >
                        {token}
                      </span>
                      {i < arr.length - 1 && (
                        <span
                          aria-hidden
                          className="font-mono text-[11px] text-neutral-400"
                        >
                          →
                        </span>
                      )}
                    </span>
                  )
                )}
              </div>
              {/* From sm up: the horizontal rail, pills seated on one line,
                  a spark sweeping each connector as the pulse passes. */}
              <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-y-4">
                {['Brief', 'Creator', 'Deliverable', 'Payment', 'History'].map(
                  (token, i, arr) => (
                    <div key={token} className="flex items-center">
                      <span
                        className="chain-token rounded-full border border-[oklch(0.79_0.004_220)] bg-white px-5 py-2.5 font-mono text-xs uppercase tracking-[0.08em] text-neutral-600 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-brand hover:text-brand-ink lg:px-6 lg:py-3 lg:text-[13px]"
                        style={{ '--chain-i': i } as React.CSSProperties}
                      >
                        {token}
                      </span>
                      {i < arr.length - 1 && (
                        <span
                          aria-hidden
                          className="chain-link h-px w-6 bg-neutral-300 sm:w-12 lg:w-24"
                          style={{ '--chain-i': i } as React.CSSProperties}
                        />
                      )}
                    </div>
                  )
                )}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  BRAND WORKSPACE â€” feature list + stacked app frames              */}
        {/* ---------------------------------------------------------------- */}
        <section id="for-brands" className="scroll-mt-28 py-16 sm:py-20">
          <div className="w-full px-5 sm:px-9">
            <SectionIntro
              label="The brand workspace"
              title={
                <>
                  Create, fund, and review
                  <br />
                  <em className="not-italic text-brand">from one dashboard.</em>
                </>
              }
            />

            <div className="mt-16 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-16">
              {/* Feature list as the deal's own progress rail — the same
                  grammar as the rail inside the screenshot beside it: mono
                  step nodes on a vertical hairline, the active step filled
                  teal, and the flight stretched to run the mock's full
                  height so the two rails read as one system. */}
              <Reveal className="lg:h-full">
                <ol className="lg:flex lg:h-full lg:flex-col">
                  {WORKSPACE_FEATURES.map((f, i) => (
                    <li
                      key={f.title}
                      className="group relative flex gap-5 pb-9 last:pb-0 sm:gap-6 lg:flex-1 lg:pb-0 lg:last:flex-none"
                    >
                      <div className="flex flex-col items-center">
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-medium tabular-nums transition-all duration-300 ease-out',
                            f.active
                              ? 'node-breathe border-brand bg-brand text-neutral-50 shadow-[0_0_0_4px_oklch(0.51_0.11_185/0.15)]'
                              : 'border-[oklch(0.79_0.004_220)] bg-white text-neutral-600 group-hover:border-brand group-hover:text-brand group-hover:shadow-[0_0_0_4px_oklch(0.51_0.11_185/0.1)]'
                          )}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {i < WORKSPACE_FEATURES.length - 1 && (
                          <span
                            aria-hidden
                            className="mt-2 w-px flex-1 bg-neutral-200 transition-colors duration-300 ease-out group-hover:bg-brand/40"
                          />
                        )}
                      </div>
                      <div className="pt-1.5 transition-transform duration-300 ease-out group-hover:translate-x-0.5">
                        <h3
                          className={cn(
                            'font-display text-lg font-medium leading-snug transition-colors duration-300 ease-out sm:text-xl',
                            f.active
                              ? 'text-brand'
                              : 'text-neutral-900 group-hover:text-brand-ink'
                          )}
                        >
                          {f.title}
                        </h3>
                        <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-neutral-600">
                          {f.desc}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Reveal>

              {/* The real review screen: identity, progress rail, the
                  submitted video, and the approve control â€” captured from
                  the populated demo workspace, not rebuilt in CSS. */}
              <Reveal delay={80} className="mt-12 lg:mt-0">
                <AppFrame>
                  <Image
                    src="/marketing/deal-review.png"
                    alt=""
                    width={1666}
                    height={1472}
                    unoptimized
                    className="h-auto w-full bg-white"
                  />
                </AppFrame>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  CREATORS â€” stats band + creator app frame                        */}
        {/* ---------------------------------------------------------------- */}
        <section id="for-creators" className="scroll-mt-28 py-16 sm:py-20">
          <div className="w-full px-5 sm:px-9">
            <SectionIntro
              label="For creators"
              title={
                <>
                  Get paid for what you
                  <br />
                  <em className="not-italic text-brand">already do.</em>
                </>
              }
            />

            <Reveal delay={120} className="mt-16">
              {/* The creator workspace itself: payouts, escrow, profile, and
                  rate â€” the populated demo account, captured not rebuilt. */}
              <AppFrame className="mx-auto max-w-5xl">
                <Image
                  src="/marketing/creator-home.png"
                  alt=""
                  width={2880}
                  height={2160}
                  unoptimized
                  className="h-auto w-full bg-white"
                />
              </AppFrame>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  PRICING â€” commission model as bordered cards                     */}
        {/* ---------------------------------------------------------------- */}
        <section id="pricing" className="scroll-mt-28 py-16 sm:py-20">
          <div className="w-full px-5 sm:px-9">
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
            />

            {/* Two banded chapter panels: teal-washed header band over a
                hairline ledger of inclusions â€” the deals-inbox grammar. */}
            <div className="mt-16 grid gap-6 md:grid-cols-2 md:gap-8">
              {[
                {
                  title: 'For brands',
                  cta: 'Create a brand account',
                  href: '/sign-up?role=brand',
                  rows: BRAND_PRICING,
                },
                {
                  title: 'For creators',
                  cta: 'Create a creator account',
                  href: '/sign-up?role=creator',
                  rows: CREATOR_PRICING,
                },
              ].map((card, i) => (
                <Reveal key={card.title} delay={i * 100} className="h-full">
                  <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-[oklch(0.79_0.004_220)] bg-white shadow-[0_2px_0_rgba(23,23,23,0.07)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_0_rgba(23,23,23,0.07),0_18px_36px_-24px_oklch(0.51_0.11_185/0.4)]">
                    <div className="flex items-center gap-4 border-b border-neutral-200 bg-brand-tint/40 px-6 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-ink">
                        {card.title}
                      </p>
                      <span aria-hidden className="h-px flex-1 bg-brand/20" />
                    </div>
                    <div className="flex flex-1 flex-col p-6 sm:p-8">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-3xl font-medium tracking-tight text-neutral-900">
                          Free
                        </span>
                        <span className="text-sm text-neutral-600">
                          to join
                        </span>
                      </div>
                      <ul className="mt-6 divide-y divide-neutral-200 border-y border-neutral-200">
                        {card.rows.map((row) => (
                          <li
                            key={row}
                            className="group/row flex items-center gap-3 py-3 text-[13px] text-neutral-800 transition-colors duration-300 ease-out hover:text-neutral-950"
                          >
                            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-ink transition-transform duration-300 ease-out group-hover/row:scale-110">
                              <Check
                                className="h-2.5 w-2.5"
                                weight="bold"
                                aria-hidden
                              />
                            </span>
                            {row}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-auto pt-6">
                        <Link
                          href={card.href}
                          className="group/cta inline-flex items-center gap-2 text-[13px] font-semibold text-brand-ink transition-colors duration-300 ease-out hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                        >
                          {card.cta}
                          <ArrowRight
                            className="h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover/cta:translate-x-0.5"
                            aria-hidden
                          />
                        </Link>
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  FAQ                                                              */}
        {/* ---------------------------------------------------------------- */}
        <section id="faq" className="scroll-mt-28 py-16 sm:py-20">
          <div className="w-full px-5 sm:px-9">
            <div className="grid gap-10 lg:grid-cols-[2fr_3fr] lg:gap-16">
              {/* The question rail: heading, count, and a nudge, pinned while
                  the ledger scrolls past. */}
              <Reveal className="lg:sticky lg:top-28 lg:self-start">
                <div className="flex items-center gap-4">
                  <SectionLabel as="p" className={FLAT_LABEL}>
                    FAQ
                  </SectionLabel>
                  <span aria-hidden className="h-px w-16 bg-neutral-200" />
                </div>
                <h2 className="mt-5 font-display text-3xl font-medium tracking-tight text-neutral-900 sm:text-4xl">
                  Common questions
                </h2>
                <p className="mt-6 font-display text-[13.5px] italic text-neutral-600">
                  Still unsure? The escrow answer covers most of it.
                </p>
              </Reveal>
              {/* One framed ledger: each question a hairline-divided row that
                  washes teal on hover. */}
              <div className="overflow-hidden rounded-[20px] border border-[oklch(0.79_0.004_220)] bg-white shadow-[0_2px_0_rgba(23,23,23,0.07)]">
                {FAQ_ITEMS.map((item, i) => (
                  <Reveal key={item.q} delay={i * 40}>
                    <details className="faq-item group border-b border-neutral-200 px-6 py-5 transition-colors duration-300 ease-out last:border-b-0 hover:bg-brand-tint/15 open:bg-brand-tint/15 sm:px-8">
                      <summary className="flex list-none cursor-pointer items-center gap-4 text-[15px] font-medium text-neutral-900 transition-colors duration-300 ease-out hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 [&::-webkit-details-marker]:hidden">
                        <span
                          aria-hidden
                          className="font-mono text-[11px] tabular-nums text-neutral-400 transition-colors duration-300 ease-out group-open:text-brand group-hover:text-brand"
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="flex-1">{item.q}</span>
                        <CaretDown
                          className="h-4 w-4 shrink-0 text-neutral-600 transition-transform duration-300 ease-out group-open:rotate-180"
                          aria-hidden
                        />
                      </summary>
                      <p className="faq-answer mt-3 max-w-[60ch] pl-8 text-sm leading-relaxed text-neutral-600">
                        {item.a}
                      </p>
                    </details>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/*  FINAL CTA — the ink rail-card, asymmetric: claim left, the      */}
        {/*  ledger of facts and actions right, hairline-divided.            */}
        {/* ---------------------------------------------------------------- */}
        <section className="pb-16 sm:pb-20">
          <Reveal className="w-full px-5 sm:px-9">
            <div className="overflow-hidden rounded-[28px] bg-neutral-900 shadow-[0_32px_64px_-36px_rgba(15,55,52,0.65)]">
              {/* The ink chapter's own header band: teal eyebrow, hairline,
                  mono note — the banded-panel grammar carried onto ink. */}
              <div className="flex items-center gap-4 border-b border-neutral-50/10 bg-neutral-50/[0.03] px-7 py-3 sm:px-12">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[oklch(0.82_0.07_185)]">
                  Get started
                </p>
                <span aria-hidden className="h-px flex-1 bg-neutral-50/10" />
              </div>
              <div className="grid items-center gap-8 px-7 py-10 sm:px-12 sm:py-12 lg:grid-cols-[1fr_auto] lg:gap-12">
                <div>
                  <h2 className="font-display text-3xl font-medium tracking-tight text-neutral-50 sm:text-4xl">
                    Create your free account.
                  </h2>
                  <p className="mt-3 max-w-[44ch] text-[15px] text-neutral-400">
                    Join as a brand or creator. No credit card is required.
                  </p>
                </div>
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
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
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/*  FOOTER â€” multi-column, hairline-divided                           */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="grid w-full gap-12 px-5 sm:px-9 py-16 lg:grid-cols-[1.4fr_2fr]">
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

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
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
          <p className="w-full px-5 py-5 text-xs text-neutral-600 sm:px-9">
            &copy; {new Date().getFullYear()} Creator Marketplace. All rights
            reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
