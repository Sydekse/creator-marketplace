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

- 11 transactional email types rendered with React Email and delivered via Resend
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
