# Creator Marketplace

A two-sided marketplace where brands run paid TikTok promotion campaigns with vetted creators.

A brand funds a campaign, hand-picks tier-priced creators within its budget, and sends offers.
Creators accept standard usage-rights terms, post the video, and submit the link. The brand reviews
and approves; the creator is paid out of escrow, net of platform commission. Engagement metrics land
back on the brand's campaign dashboard.

Funds are held in escrow from the moment a campaign is funded, and every movement is written to an
append-only ledger inside the same database transaction as the deal state change that caused it.

**Live at [creator-marketplace-mu.vercel.app](https://creator-marketplace-mu.vercel.app)**

> **Scope.** TikTok sign-ups get server-fetched stats, instant verification, and automatic tier
> assignment; the manual-entry path remains for demo (email/password) accounts only. The payment
> processor is a mock implementation behind a `PaymentProvider` interface. Everything else — auth,
> RBAC, escrow accounting, the deal state machine, email, scheduled jobs — is real.

---

## Features

**Accounts and access**

- Three roles — brand, creator, admin — gated server-side on every request and every action
- TikTok OAuth (Login Kit) for creators; email/password with OTP-verified email for demo accounts; HTTP-only session cookies
- Role-scoped route groups, so a brand route can't be reached by a creator

**Creator supply**

- Creator onboarding with TikTok handle, audience size, engagement rate, and content categories
- Sign up with TikTok: OAuth via Login Kit, stats auto-filled from the TikTok API, instant verification and tier assignment — a creator becomes bookable once a pricing tier matches their numbers
- Three pricing tiers seeded from config, priced per video

**Campaigns**

- Campaign briefs with budget, video count, and requirements
- Creator discovery with category, follower, and price filters
- A shortlist that enforces the budget ceiling as a server-side invariant, re-checked on confirm
  and again on fund
- Versioned usage-rights terms, snapshotted onto each deal at acceptance
- Campaign Insights: recorded costs/results, separate CPV/CPE cohorts, creator
  contributions, and your brand's collaboration evidence (see below).

### Campaign Insights: interpreting the evidence

Non-draft campaign pages keep funding and the authoritative settlement panel
above insights; the draft cart is unchanged. Recharts v3 renders small client
islands beside server-rendered exact values. All comparisons and sorting use
the same pure model, with unavailable ratios last. Native disclosures, contained
table scrolling, fixed chart dimensions and non-animated bars support keyboard,
touch and reduced motion. Campaign routes deliberately do not use streaming
`loading.tsx` fallbacks: an authenticated, JavaScript-disabled browser receives
the exact values rather than a loading screen that needs a script to resolve.

- **Cost:** prices remain integer santim. Settled spend is ledger payout plus
  commission (never commission added twice); refunds are separate. Committed
  cost uses the existing status-aware budget policy, not the settlement total.
- **Efficiency:** video CPV uses unit price; deal CPV needs views for every
  ordered current video. CPE needs likes, comments **and** shares for every
  included video. Headline and creator figures divide summed completed,
  fully measured deal cost by summed results, never average individual ratios.
  CPV and CPE can include different deals. Measured zero-result deals retain
  their cost in a cohort; a zero total denominator is unavailable. Each chart
  states its included deals/videos/cost and exclusions.
- **Contributions:** cost share and result share always use the same eligible
  cohort. Known repeated TikTok identities exclude affected deals from
  comparisons; raw totals remain labeled as potentially double-counted.
  Opaque short-link identities are not guessed.
- **Coverage:** each count has its own measured-video denominator. Null means
  unknown, not zero. Only current-submission-version metrics are read. Raw
  totals cover all issued-deal statuses, unlike completed-deal comparisons.
  Counts are creator/admin reported; the row-wide timestamp is a last record
  update, not the measurement time of every field. Stale values stay qualified.
  Small ETB ratios use four decimal places, or `<0.0001 ETB`.
- **Your collaboration history:** includes only the viewing brand's campaigns
  involving displayed creators. Acceptance means ever accepted/all issued;
  completion means completed/ever funded, with ongoing/refunded separated.
  Deal revision incidence separates open/closed and brand/admin evidence.
  Video incidence and revision-free batch approvals require fully captured
  history; revision rounds are separate counts. Admin payment release is not
  brand approval. Reported reason categories remain feedback, including unknown.
- **Elapsed timing:** medians and sample counts cover funding to first full
  delivery, complete review-ready cycles to recorded decisions, and rejection
  to its next-version replacement. Open waiting and interrupted intervals are
  separate, not completed samples. Missing legacy evidence never becomes an
  instant delivery or a revision-free approval. This is not active review
  effort or a judgment about responsibility.

`lib/campaigns/insights.ts` guards ownership, rechecks the owner and reads all
related rows in one read-only repeatable-read transaction. Every read is
brand-scoped; creators, videos and evidence are fetched in batches, not per card.
Pure `insight-model.ts`, `insight-history.ts` and `insight-display.ts` own
calculation and presentation projections. Read failures propagate to the route's
error handling rather than being replaced with fabricated empty data.

**Supported:** current recorded efficiency, cohort contributions, brand-only
acceptance/completion/revision evidence and recorded elapsed workflow timing.
**Limited:** legacy history, incomplete or stale manual counts, unresolved video
identities and differently aged observations. **Deferred:** fault attribution, independent video approval, automatic
deliverable metrics, growth/time-series, unique reach, conversions/ROI,
cross-brand rankings and global reliability scores.

Validation uses the existing Vitest unit/coverage and PostgreSQL integration
runners plus `e2e/campaign-insights.spec.ts` for desktop/mobile Chromium/WebKit.
Browser fixtures require an isolated local test database and include separate
CPV/CPE cohorts, measured zeros, partial coverage, stale/old-version records,
duplicates, refunds, legacy evidence, admin release and JavaScript-disabled
exact-value views. Never point fixture/migration commands at a live database.

### Delivery agreements and punctuality

Draft campaigns can record an explicit delivery window of 1–90 days, with no
default. Sending offers requires a chosen window and snapshots it onto each deal.
Creators accept the displayed window and interpretation version alongside usage
rights; stale delivery terms return 409. Already-sent legacy contracts remain
without a recorded delivery deadline. Editing a draft never changes sent offers.

`EscrowLedgerService.holdForCampaign()` initializes `fundedAt`, original and current
due dates in the successful transaction shared by mock funding and verified Chapa
settlement. A day is 24 elapsed hours; all displayed deadlines are explicitly UTC.
Retries and return/webhook replays never restart the clock. Offer expiry is a
separate acceptance deadline.

Either party can request a later delivery date on funded work before its first
complete submission. `POST /api/deals/{id}/deadline` requires `expectedDueAt`,
`proposedDueAt` and a note. `PATCH` requires the immutable `requestId`,
`expectedDueAt` and `decision` (`accepted`, `rejected`, `withdrawn`). Only the
counterparty decides; only the proposer withdraws. The service locks the deal
before requests, rechecks ownership/state/clock, and serializes submission and
refund races. One pending request per deal is enforced by a partial unique index.
Identical decisions are idempotent; conflicts return 409 with refresh guidance.
Requests are immutable proposals with one decision, not an append-only table.
In-app notifications commit with the action; email is sent afterward.

The first full delivery freezes its timestamp and effective due date; revisions,
approval and refunds cannot reset them. First delivery and refunds close pending
requests through the authoritative deal transition. Acceptance **after** the
previous due time permanently records that a commitment was missed; acceptance
at that time is still prospective. Delivery at the effective deadline is on time
only if no earlier deadline was missed. “Within extended deadline; earlier
deadline missed” remains a distinct result.

Shared deal cards, inbox summaries, Campaign Insights and owned collaboration
history use the same classifier. Rates include only initial deliveries with
trustworthy agreements; due/overdue open work, unknown legacy evidence and closed
work are separate. Admins can inspect deadline history but cannot override mutual
agreement. Timing never changes escrow, legal deal status or payment eligibility.

Migration `0019_moaning_dreadnoughts.sql` is additive and deliberately backfills no
agreement or delivery timestamps. Do not drop the history table to roll back UI.
An old-writer deployment can leave incomplete evidence; those records stay
unknown, not automatically on-time. Validate real database constraints, funding
replay, races and rollback with `tests/integration/delivery-deadlines.test.ts`;
`e2e/delivery-agreements.spec.ts` covers both parties, admin read-only visibility,
notifications, initial delivery and campaign reporting. Run these only in an
isolated CI/test database, never against preview or production data.

**Money**

- Per-deal escrow holds at the payment provider, placed when a campaign is funded
- Append-only double-entry ledger: `hold`, `release_payout`, `commission`, `refund`
- Payout on approval, net of a 15% platform commission, with both legs captured at the provider
- Declined and expired offers release their reserved cost back to the campaign budget
- All amounts stored as integers in ETB santim — never floats

**Delivery and review**

- Guarded deal state machine; an illegal transition changes nothing and returns a specific error
- Deliverable submission with TikTok URL validation
- Stable video slots and permanent submission/revision history, with structured reported revision categories
- Brand review — approve to pay, or reject with a reason while funds stay held for a revision
- Engagement metrics per video, with totals on the campaign dashboard

**Notifications**

- Transactional email types rendered with React Email and delivered via Resend,
  including delivery extension requests, decisions and withdrawals
- An in-app notification feed, written inside the same transaction as the event it describes
- Emails flush only after that transaction commits, so a mail failure can never roll back money

**Scheduled jobs**

- A daily cron job that expires offers past their 7-day window and reminds creators about
  deliverables still missing metrics after 7 days
- Bearer-token authenticated, so the endpoint isn't reachable from the public internet

**Admin console**

- Verification queue and tier assignment
- Campaign and deal inspection, including a per-campaign ledger view
- Dispute resolution to completed, refunded, or revision-requested
- An append-only audit log of every admin action, with actor and timestamp

---

## The loop

```
BRAND                              CREATOR                       ADMIN
  │                                                                │
  ├─ sign up, create profile                                       │
  │                              sign up w/ TikTok, auto-verify ──►│ assign tier
  │                              refresh stats (self + weekly cron)│ review downgrade flags
  ├─ write campaign brief                                          │
  ├─ discover creators ◄──────────── (verified + tiered only) ─────┘
  ├─ shortlist within budget
  ├─ confirm  ──► offers sent ──►  accept usage-rights terms
  ├─ fund     ──► escrow hold per deal
  │                                post video, submit link
  ├─ review ──┬─ approve ──► creator paid, commission captured
  │           └─ reject ───► revision requested, funds stay held
  └─ campaign dashboard ◄──── engagement metrics recorded
```

Deal statuses: `pending` → `accepted` → `funded` → `delivered` → `completed`, with `declined`,
`expired`, `revision_requested`, and `refunded` as branches.

---

## Stack

|           |                                                                |
| --------- | -------------------------------------------------------------- |
| Framework | Next.js 16.2 (App Router, Server Components, Route Handlers)   |
| UI        | React 19.2, Tailwind CSS v4, Base UI primitives, Framer Motion |
| Database  | Postgres (Neon) with Drizzle ORM and drizzle-kit migrations    |
| Auth      | Better Auth                                                    |
| Email     | Resend with React Email                                        |
| Testing   | Vitest, Playwright                                             |
| Hosting   | Vercel, with Vercel Cron for scheduled jobs                    |

Requires Node 25 (see `.nvmrc`).

---

## Getting started

```bash
npm install

cp .env.example .env.local     # fill in the values — see below

npm run db:migrate             # create the schema
npm run db:seed                # pricing tiers, rights terms, and demo data

npm run dev                    # http://localhost:3000
```

### Environment variables

| Variable                         | Required  | Notes                                                                                                                            |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | yes       | Postgres connection string. Use the pooled host (contains `-pooler`) so serverless functions don't exhaust the connection limit. |
| `BETTER_AUTH_SECRET`             | yes       | Signs session cookies. Generate with `openssl rand -base64 32`.                                                                  |
| `BETTER_AUTH_URL`                | yes       | The app's canonical origin. Must match the deployment it runs on; also used to build links inside emails.                        |
| `RESEND_API_KEY`                 | for email | Resend API key.                                                                                                                  |
| `EMAIL_FROM`                     | for email | A verified sender, e.g. `Creator Marketplace <noreply@example.com>`.                                                             |
| `EMAIL_SEND`                     | for email | Must be exactly `"true"`.                                                                                                        |
| `EMAIL_TEST_INBOX`               | no        | When set, every email is redirected to this address with the intended recipient in the subject line.                             |
| `CRON_SECRET`                    | for cron  | Bearer token required by the cron endpoint. Generate with `openssl rand -hex 32`.                                                |
| `CHAPA_SECRET_KEY`               | for Chapa | Chapa secret key (`CHASECK_TEST-…` in test mode). Unset → the instant mock payment provider (CI, e2e, offline dev).              |
| `CHAPA_WEBHOOK_SECRET`           | for Chapa | The webhook secret hash configured in the Chapa dashboard. Verifies `chapa-signature` on `/api/webhooks/chapa`.                  |
| `CHAPA_TRANSFER_APPROVAL_SECRET` | for Chapa | The transfer-approval secret from the dashboard (max 25 chars there). Verifies `/api/webhooks/chapa/transfer-approval`.          |

Real email sending requires three switches together: `EMAIL_SEND === "true"`, `RESEND_API_KEY`, and
`EMAIL_FROM`. If any is missing, the app falls back to a console provider that logs each message
instead of sending it — so an environment that inherits credentials still won't mail real users
until sending is explicitly turned on.

### Chapa (payments)

Payments run in one of two modes, decided by `CHAPA_SECRET_KEY` alone:

- **Mock mode** (unset): funding is an instant in-process call, withdrawals and refunds are
  ledger-only. This is what CI, e2e, and seeded demo data use.
- **Chapa mode** (set): brands deposit through Chapa's hosted checkout, creators withdraw via the
  Transfers API, and dispute refunds go back to the brand's original payment method via the Refund
  API. Internal escrow accounting (the append-only ledger) is identical in both modes — Chapa only
  touches money at those three edges.

Dashboard setup (test mode — [dashboard.chapa.co](https://dashboard.chapa.co)):

1. **Webhook** (Settings → Webhooks): URL `https://<host>/api/webhooks/chapa`, secret hash =
   `CHAPA_WEBHOOK_SECRET`. Tick both "Receive Webhook" boxes. The same endpoint handles funding,
   payout, and refund events.
2. **Transfers** (Settings → General/Preference): enable **API Transfers**; tick **Approve
   transfers using URL verification**; approval URL
   `https://<host>/api/webhooks/chapa/transfer-approval`, approval secret =
   `CHAPA_TRANSFER_APPROVAL_SECRET` (the dashboard caps this field at 25 characters, which is why
   it is a separate, shorter secret).
3. Optionally set the **Refund Webhook** field to the same `/api/webhooks/chapa` URL.

Test mode moves no real money: use Chapa's published test cards / test telebirr numbers at
checkout (the fund dialog shows a hint), and transfers/refunds are simulated as successful.
`/admin/payments` shows every deposit, withdrawal, and refund with its gateway status, plus the
totals to reconcile the ledger against the Chapa dashboard balance.

`.env.example` documents every variable in full.

---

## Scripts

| Command                    |                                                  |
| -------------------------- | ------------------------------------------------ |
| `npm run dev`              | Development server                               |
| `npm run build`            | Production build                                 |
| `npm start`                | Serve a production build                         |
| `npm run lint`             | ESLint                                           |
| `npm run typecheck`        | `tsc --noEmit`                                   |
| `npm run format:check`     | Prettier check — `npx prettier --write .` to fix |
| `npm test`                 | Unit test suite                                  |
| `npm run test:integration` | Integration suite (requires a database)          |
| `npm run test:e2e`         | Playwright end-to-end suite                      |
| `npm run db:generate`      | Generate a migration from schema changes         |
| `npm run db:migrate`       | Apply pending migrations                         |
| `npm run db:seed`          | Load tiers, rights terms, and demo data          |
| `npm run email:preview`    | Render every email template to `.email-preview/` |

---

## Project structure

```
app/
  (auth)/                  sign-in, sign-up
  (brand)/(onboarded)/     dashboard, campaigns, discovery, deals
  (creator)/creator/       dashboard, onboarding, deals
  (admin)/admin/           tiers, campaigns, deals, worklist, audit log
  api/                     31 route handlers
  notifications/           in-app notification feed

lib/
  auth.ts, authz.ts        auth wiring and role/ownership guards
  campaigns/               briefs, shortlist, budget, confirm, fund
  creators/                onboarding, verification, tiers, discovery
  deals/                   state machine, offers, delivery, review
  payment/                 provider contract, mock provider, ledger, holds
  notifications/           notification rows, email templates, delivery
  validation/              schemas and the shared error envelope
  config/                  pricing tiers, commission, offer window, rights terms
  audit/                   append-only admin log
  scheduler/               cron harness

db/                        schema, migrations, seed
components/                UI primitives and feature components
```

### Data model

23 tables. The core domain ones:

`creator_profile` · `brand_profile` · `pricing_tier` · `campaign` · `campaign_item` ·
`rights_terms` · `deal` · `deal_event` · `deliverable` · `deliverable_event` · `video_metric` · `ledger_entry` ·
`audit_log` · `notification` · `provider_hold`

Plus `user`, `session`, `account`, and `verification`, managed by Better Auth.

`deal_event`, `deliverable_event`, `ledger_entry`, and `audit_log` are append-only — inserts only, never updates — so the
history of a deal and of every money movement is permanent.

### Deliverable evidence and version consistency

`deliverable.video_ordinal` is assigned under the deal lock and never changes on replacement.
New videos begin at submission version 1. Migration `0018_kind_hemingway.sql` adopts surviving
legacy rows as version 0 in deterministic submitted-time/ID order, preserving the currently
recorded URL, review note/status, timestamps and latest metrics in a `legacy_baseline` event.
This is not a reconstructed first submission: prior revisions and actor identities remain unknown.
The completeness marker stays limited even after a legacy video is replaced.

Submission, supersession, revision, review-ready/interrupted cycles and final dispositions are
written inside the authoritative domain transaction. Partial submissions create video events
without changing deal status. Approval remains one deal-level payout; all final versions receive
batch approval together. Admin release/refund are distinct outcomes, and admin revision names
one current video that the creator can replace. Event sequence orders tied timestamps.

Submission bodies require `requestId` (UUID), `deliverableId` (null for a new slot),
`expectedVersion` (0 for a new slot) and `expectedSubmitted`, alongside `tiktokUrl`.
Retry the same request ID/payload after a lost response; changing its payload is a conflict.
Rejection requires `deliverableId`, `expectedVersion`, `category` and `reason`.
Approval takes `expectedVersions: [{ id, submissionVersion }]`, never payment amounts.
Metrics require `expectedVersion` plus one or more counts; version 0 remains writable.
`DELIVERABLE_VERSION_STALE` is a 409 instructing the user to reload.

Replacing even the same URL archives the prior latest metric row as supersession evidence,
then clears current metrics and media atomically. Metrics lock the deal before checking the
current version. Post-commit thumbnail saves compare version and prior thumbnail atomically;
losing results are discarded and only unreferenced application blobs are cleaned up.
Historical evidence retains URLs/text, not a thumbnail/video-file archive.

Supported now: recorded revision reasons, submission versions, deal review-cycle evidence and
current-version metric isolation. Partial: historical coverage (explicitly limited for legacy
records), best-effort current thumbnails, and manually reported latest metrics. Deferred:
Campaign Insights/ratios/charts, agreed deadlines/punctuality, independent video approval,
automatic metrics, time series and historical media storage.

Deploy the additive migration together with the version-aware application; older forms must
reload. Do not drop evidence tables for an application rollback. An older writer can leave
coverage gaps: use a forward fix or explicitly mark affected history limited, never claim
gap-free evidence across an old-writer deployment. Database migration/integration tests must
use an isolated disposable database, not preview or production.

### API errors

Every error response has the same shape:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable.",
    "details": {}
  }
}
```

---

## Testing

**2,797 unit tests across 60 files**, plus an integration suite and seven Playwright end-to-end
specs covering the full marketplace loop, the budget ceiling, offer decline and expiry, deliverable
rejection, payment failure, dispute refunds, and access-control negatives.

Coverage is enforced in CI over `lib/`. The deal state machine and the ledger money math are held at
100%, including every illegal state transition.

```bash
npm run lint && npm run typecheck && npm run format:check && npm test
```

---

## Deployment

Deployed on Vercel from `main`. The build applies any pending migrations before compiling, and the
daily cron job is registered in `vercel.json`.

Set every environment variable from the table above under **Settings → Environment Variables**,
scoped per environment, and make sure `BETTER_AUTH_URL` matches the deployment's own host.
