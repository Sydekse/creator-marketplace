import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import { formatDeadline } from '@/lib/dates';
import { formatEtb } from '@/lib/money';
import type {
  EmailMessage,
  NotificationInput,
  NotificationPayloadMap,
} from './types';

/**
 * Email bodies for every notification type (KAN-54 AC-2).
 *
 * Two rules run through all of them, both from AC-5 / NFR-010:
 *
 *   - **No secrets.** Nothing here embeds a token, a session, or a magic link.
 *     Every call to action is a plain link to a page behind the normal login,
 *     so an email forwarded or sitting in a breached mailbox grants nothing.
 *   - **No unnecessary PII.** A creator's email tells them about *their* deal;
 *     it does not carry the brand's contact details, and a brand's email names
 *     the creator by TikTok handle — already public — rather than by legal name.
 */

/**
 * Where links point.
 *
 * `BETTER_AUTH_URL` is already the canonical origin for this deployment, so
 * reusing it means email links and auth callbacks cannot drift apart. Falling
 * back to localhost keeps tests and `next build` (which has no env) working;
 * a wrong link in a dev email is not worth a hard failure at import time.
 */
function appUrl(path: string): string {
  const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  return new URL(path, base).toString();
}

/**
 * Every path passed to `appUrl` must resolve to a real route.
 *
 * Five of these pointed at `/brand/campaigns`, which has never existed — the
 * brand campaign routes live at `/campaigns`, inside the `(brand)/(onboarded)`
 * group, and a route group's folder name is not part of the URL. Three of the
 * five (`offer_accepted`, `offer_declined`, `offer_expired`) were already sending
 * brands to a 404 in production. Nothing caught it: no test asserted a CTA href,
 * and a wrong link is invisible to the type checker, to `next build`, and to
 * anyone reading the template.
 *
 * `__tests__/campaign-funding.test.ts` now resolves every literal in this file
 * against `app/`, so a CTA to a route that does not exist fails the suite. Keep
 * the paths as inline literals for that reason — a computed path is one the guard
 * cannot check.
 *
 * The three notifications carrying a `campaignId` deep-link to that campaign
 * rather than the list. They are all about one campaign, and the brand receiving
 * "a creator accepted" has to open that campaign to fund it.
 *
 * KAN-55 made that four: `offer_expired` now carries a `campaignId` too, because
 * the sweep that writes it already had one. What is left on a list URL is
 * `dispute_resolved`, and that one is reasoned rather than pending — see its
 * comment. Every other CTA is a deep link.
 */

/**
 * Re-exported so `lib/notifications/index.ts` keeps its surface and the KAN-54
 * tests that import it from there keep working. Both implementations moved out
 * for the same bundling reason — `formatEtb` to `lib/money.ts` on KAN-24,
 * `formatDeadline` to `lib/dates.ts` on KAN-39. See those modules for why.
 */
export { formatEtb, formatDeadline };

const styles = {
  body: {
    backgroundColor: '#f3f4f2',
    fontFamily:
      "Geist, 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    margin: '0',
    padding: '24px 12px',
  },
  container: {
    backgroundColor: '#fafafa',
    border: '1px solid #dedfdd',
    borderRadius: '24px',
    margin: '16px auto',
    maxWidth: '580px',
    overflow: 'hidden',
  },
  masthead: {
    backgroundColor: '#171717',
    padding: '20px 28px',
  },
  brand: {
    color: '#fafafa',
    fontSize: '13px',
    fontWeight: 600,
    letterSpacing: '-0.1px',
    lineHeight: '20px',
    margin: 0,
  },
  brandMark: {
    display: 'inline-block',
    verticalAlign: 'middle',
    marginRight: '10px',
  },
  content: {
    padding: '36px 40px 28px',
  },
  eyebrow: {
    color: '#166b63',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1.5px',
    lineHeight: '16px',
    margin: '0 0 12px',
    textTransform: 'uppercase' as const,
  },
  heading: {
    color: '#171717',
    fontSize: '28px',
    fontWeight: 600,
    letterSpacing: '-0.7px',
    lineHeight: '34px',
    margin: '0 0 20px',
  },
  text: {
    color: '#525252',
    fontSize: '15px',
    lineHeight: '25px',
    margin: '0 0 16px',
  },
  footer: {
    backgroundColor: '#f5f5f4',
    borderTop: '1px solid #dedfdd',
    padding: '20px 40px 24px',
  },
  muted: {
    color: '#737373',
    fontSize: '12px',
    lineHeight: '19px',
    margin: 0,
  },
  hr: { borderColor: '#dedfdd', margin: '28px 0 20px' },
  linkWrap: { margin: '24px 0 4px' },
  link: {
    backgroundColor: '#171717',
    borderRadius: '999px',
    color: '#fafafa',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '20px',
    padding: '12px 18px',
    textDecoration: 'none',
  },
  // The money breakdown (AC-3, AC-4). Set off from the prose because it is a
  // receipt rather than a sentence, and a creator checking what they were paid
  // should find the figures without reading.
  breakdown: {
    borderBottom: '1px solid #dedfdd',
    borderTop: '1px solid #dedfdd',
    margin: '8px 0 20px',
    padding: '14px 0',
  },
  breakdownRow: {
    color: '#525252',
    fontFamily: "'DM Mono', 'SFMono-Regular', Consolas, monospace",
    fontSize: '13px',
    lineHeight: '21px',
    margin: '0 0 6px',
  },
  breakdownNet: {
    borderTop: '1px solid #dedfdd',
    color: '#171717',
    fontFamily: "'DM Mono', 'SFMono-Regular', Consolas, monospace",
    fontSize: '14px',
    lineHeight: '22px',
    margin: '10px 0 0',
    paddingTop: '10px',
  },
} as const;

function Layout({
  preview,
  heading,
  children,
}: {
  preview: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      {/* The inbox preview line. Without it clients pull the first body text,
          which is often the least informative sentence in the email. */}
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.masthead}>
            <Text style={styles.brand}>
              <span style={styles.brandMark} aria-hidden="true">
                <span
                  style={{
                    display: 'inline-block',
                    width: 20,
                    height: 20,
                    position: 'relative',
                    verticalAlign: 'middle',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      width: 12,
                      height: 12,
                      borderRadius: 4,
                      backgroundColor: '#fafafa',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                    }}
                  />
                  <span
                    style={{
                      display: 'block',
                      width: 12,
                      height: 12,
                      borderRadius: 4,
                      backgroundColor: '#a1a1aa',
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                    }}
                  />
                </span>
              </span>{' '}
              Creator Marketplace
            </Text>
          </Section>
          <Section style={styles.content}>
            <Text style={styles.eyebrow}>Account activity</Text>
            <Heading style={styles.heading}>{heading}</Heading>
            <Section>{children}</Section>
            <Hr style={styles.hr} />
            <Text style={styles.muted}>
              Creator Marketplace — you are receiving this because of activity
              on your account.
            </Text>
          </Section>
          <Section style={styles.footer}>
            <Text style={styles.muted}>
              You are receiving this email because of activity on your Creator
              Marketplace account.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function Cta({ href, label }: { href: string; label: string }) {
  return (
    <Text style={styles.linkWrap}>
      <Link href={href} style={styles.link}>
        {label}
      </Link>
    </Text>
  );
}

/** The three figures a money email must state (AC-3, AC-4). */
interface Split {
  totalPrice: number;
  commission: number;
  payout: number;
}

/**
 * The trio, or `null` when this payload predates KAN-55.
 *
 * All three or none: a breakdown missing a line is worse than no breakdown,
 * because two figures that do not visibly reconcile read as an error in the
 * arithmetic rather than as an older record. The one thing never done here is
 * to fill a gap by subtraction — a template that computes `totalPrice -
 * commission` becomes a second source for a split that `computeSplit` already
 * owns (`lib/payment/ledger.ts`), and the two could disagree on a rounding.
 *
 * Structurally typed on purpose, so the three payloads that carry money satisfy
 * it whichever of the three fields each one has as required.
 */
function splitOf(payload: {
  totalPrice?: number;
  commission?: number;
  payout?: number;
}): Split | null {
  const { totalPrice, commission, payout } = payload;
  if (
    totalPrice === undefined ||
    commission === undefined ||
    payout === undefined
  ) {
    return null;
  }
  return { totalPrice, commission, payout };
}

/**
 * Gross, commission, net — the whole of AC-3's last clause and AC-4.
 *
 * Three lines rather than a sentence, because the plain-text render (AC-5) turns
 * each `Text` into its own line and a creator comparing what they expected
 * against what arrived is scanning, not reading. `formatEtb` is the only thing
 * between a value and the screen; there is no arithmetic in this file.
 *
 * `netLabel` exists because an offer is conditional and a payment is not. "You
 * receive" on an offer the creator has not accepted yet would state as settled
 * something they are still deciding.
 */
function Breakdown({
  totalPrice,
  commission,
  payout,
  netLabel = 'You receive',
}: Split & { netLabel?: string }) {
  return (
    <Section style={styles.breakdown}>
      <Text style={styles.breakdownRow}>
        Deal total: {formatEtb(totalPrice)}
      </Text>
      <Text style={styles.breakdownRow}>
        Less platform commission: {formatEtb(commission)}
      </Text>
      <Text style={styles.breakdownNet}>
        <strong>
          {netLabel}: {formatEtb(payout)}
        </strong>
      </Text>
    </Section>
  );
}

/** Subject lines. Kept beside the bodies so the two cannot drift. */
const subjects: {
  [K in keyof NotificationPayloadMap]: (p: NotificationPayloadMap[K]) => string;
} = {
  offer_received: (p) => `${p.companyName} sent you an offer`,
  verification_result: (p) =>
    p.outcome === 'approved'
      ? 'Your creator profile is verified'
      : 'Your creator profile needs another look',
  campaign_funded: (p) => `${p.campaignTitle} is funded`,
  deliverable_submitted: (p) => `A video was submitted for ${p.campaignTitle}`,
  deliverable_approved: (p) => `Your video for ${p.campaignTitle} was approved`,
  revision_requested: (p) => `Changes requested for ${p.campaignTitle}`,
  dispute_resolved: (p) => `A decision was made on ${p.campaignTitle}`,
  offer_expired: (p) => `An offer for ${p.campaignTitle} expired`,
  offer_accepted: (p) =>
    `Fund ${p.campaignTitle} — ${p.creatorHandle} accepted`,
  offer_declined: (p) => `${p.creatorHandle} declined your offer`,
  metric_reminder: (p) => `Metrics still pending for ${p.campaignTitle}`,
  tier_upgraded: (p) => `You moved up to the ${p.tierName} tier`,
};

function Content({ type, payload }: NotificationInput): React.ReactElement {
  switch (type) {
    case 'offer_received': {
      // AC-3: video count, price, **payout net of commission**, expiry. The net
      // is the figure the decision actually turns on, and until KAN-55 this
      // email named the gross and pointed at the offer screen for the rest.
      const split = splitOf(payload);
      return (
        <Layout
          preview={`${payload.companyName} wants ${payload.videoCount} video(s)`}
          heading="You have a new offer"
        >
          <Text style={styles.text}>
            <strong>{payload.companyName}</strong> invited you to{' '}
            {payload.campaignTitle}.
          </Text>
          {split ? (
            <>
              <Text style={styles.text}>
                The offer is for {payload.videoCount} video
                {payload.videoCount === 1 ? '' : 's'}.
              </Text>
              <Breakdown {...split} netLabel="You would receive" />
            </>
          ) : (
            <Text style={styles.text}>
              {payload.videoCount} video{payload.videoCount === 1 ? '' : 's'}{' '}
              for <strong>{formatEtb(payload.totalPrice)}</strong> total, before
              the platform commission shown on the offer.
            </Text>
          )}
          <Text style={styles.text}>
            The offer expires on {formatDate(payload.offerExpiresAt)}. After
            that it is released automatically.
          </Text>
          <Cta href={appUrl('/creator/deals')} label="Review the offer →" />
        </Layout>
      );
    }

    case 'verification_result':
      return payload.outcome === 'approved' ? (
        <Layout
          preview="Brands can now find you"
          heading="Your profile is verified"
        >
          <Text style={styles.text}>
            You are now visible to brands and can start receiving offers.
          </Text>
          <Cta href={appUrl('/creator')} label="View your profile →" />
        </Layout>
      ) : (
        <Layout
          preview="Your profile was not approved"
          heading="Your profile needs another look"
        >
          <Text style={styles.text}>
            We could not verify your profile as submitted.
          </Text>
          {payload.reason ? (
            <Text style={styles.text}>{payload.reason}</Text>
          ) : null}
          <Cta href={appUrl('/creator')} label="Review your profile →" />
        </Layout>
      );

    case 'campaign_funded':
      return (
        <Layout
          preview={`${payload.campaignTitle} is funded`}
          heading="Your campaign is funded"
        >
          <Text style={styles.text}>
            <strong>{formatEtb(payload.totalHeld)}</strong> is held in escrow
            across {payload.dealCount} deal
            {payload.dealCount === 1 ? '' : 's'} for {payload.campaignTitle}.
          </Text>
          <Text style={styles.text}>
            Creators are paid from escrow only after you approve their video.
          </Text>
          <Cta
            href={appUrl(`/campaigns/${payload.campaignId}`)}
            label="Open the campaign →"
          />
        </Layout>
      );

    case 'deliverable_submitted':
      return (
        <Layout
          preview={`A video is waiting for review`}
          heading="A video is ready for review"
        >
          <Text style={styles.text}>
            A creator submitted their video for {payload.campaignTitle}.
          </Text>
          <Text style={styles.text}>
            Approving it releases their payment from escrow.
          </Text>
          {/* Straight to the deal, which is the whole point of the mail. This
              pointed at `/campaigns` until the brand had a review surface — a
              page that showed neither the video nor a control to act on it, so
              KAN-46's "the brand is notified that a video is awaiting review" was
              satisfied by a link to nothing. The payload's `dealId` is enough for
              the deep link, which is why the route is `/deals/[id]` rather than
              nested under the campaign. */}
          <Cta
            href={appUrl(`/deals/${payload.dealId}`)}
            label="Review the video →"
          />
        </Layout>
      );

    case 'deliverable_approved': {
      // AC-4. This is the email a creator actually receives when they are paid —
      // approval and payout happen in one transaction. A separate `payout_sent`
      // notice was dropped with its type (KAN-55 review): it had no producer,
      // and two emails seconds apart would say one thing twice. If a real
      // processor ever makes settlement async (Q3), add the type back — the
      // exhaustive case/sample guards will demand its template and subject.
      const split = splitOf(payload);
      return (
        <Layout
          preview="Your video was approved"
          heading="Your video was approved"
        >
          <Text style={styles.text}>
            Your video for {payload.campaignTitle} was approved.
          </Text>
          {split ? (
            <>
              <Text style={styles.text}>
                <strong>{formatEtb(split.payout)}</strong> is on its way to you.
              </Text>
              <Breakdown {...split} />
            </>
          ) : (
            <Text style={styles.text}>
              <strong>{formatEtb(payload.payout)}</strong> is on its way to you,
              after the platform commission shown on the deal.
            </Text>
          )}
          <Cta href={appUrl('/creator/deals')} label="View the deal →" />
        </Layout>
      );
    }

    case 'revision_requested':
      return (
        <Layout
          preview="Changes were requested"
          heading="Changes were requested"
        >
          <Text style={styles.text}>
            The brand asked for changes to your video for{' '}
            {payload.campaignTitle}.
          </Text>
          {/* Which video (F38). A deal can hold several, and the note below is
              about one of them — as plain text, because nothing in an email
              should invite a click through to a link the platform never
              fetched (Tech Spec §6.3). */}
          <Text style={styles.text}>{payload.tiktokUrl}</Text>
          <Text style={styles.text}>{payload.reason}</Text>
          <Text style={styles.text}>
            Your payment stays in escrow while you re-submit.
          </Text>
          <Cta href={appUrl('/creator/deals')} label="Submit a new video →" />
        </Layout>
      );

    case 'dispute_resolved':
      return (
        <Layout
          preview="A decision was made"
          heading="A decision was made on your deal"
        >
          <Text style={styles.text}>
            An administrator reviewed the deal for {payload.campaignTitle} and{' '}
            {resolutionPhrase(payload.resolution)}.
          </Text>
          {/* The only CTA here that is deliberately not a deep link, and it must
              stay that way while one payload serves both parties. A resolution
              is sent to the brand *and* the creator, whose deal screens are
              different routes (`/deals/[id]` and `/creator/deals`), and the
              payload cannot know which of the two is reading. `/dashboard`
              redirects each role to their own home, so it is right for both;
              either concrete route would be a 403 for half the recipients.
              Splitting this into two notifications is the real fix. */}
          <Cta href={appUrl('/dashboard')} label="View the deal →" />
        </Layout>
      );

    case 'offer_expired':
      return (
        <Layout preview="An offer expired" heading="An offer expired">
          <Text style={styles.text}>
            The offer for {payload.campaignTitle} expired before it was
            accepted.
          </Text>
          <Text style={styles.text}>
            <strong>{formatEtb(payload.releasedAmount)}</strong> is back in your
            available budget and can be offered to another creator.
          </Text>
          {/* Deep-linked from KAN-55: re-offering the released budget happens on
              the campaign, so the list was one click short of the thing the mail
              asks for. The sweep already had `campaignId` in hand and dropped it
              (`expire-offers.ts`). The fallback is for rows written before that,
              whose payload has no id to link with. */}
          {payload.campaignId ? (
            <Cta
              href={appUrl(`/campaigns/${payload.campaignId}`)}
              label="Open the campaign →"
            />
          ) : (
            <Cta href={appUrl('/campaigns')} label="Open your campaigns →" />
          )}
        </Layout>
      );

    case 'offer_accepted':
      return (
        <Layout
          preview={`Fund ${payload.campaignTitle} — accept is not funding`}
          heading="Time to fund this campaign"
        >
          <Text style={styles.text}>
            <strong>{payload.creatorHandle}</strong> accepted your offer for{' '}
            {payload.campaignTitle} and agreed to the usage-rights terms.
          </Text>
          <Text style={styles.text}>
            Acceptance does not move money. Open the campaign and fund it so{' '}
            <strong>{formatEtb(payload.totalPrice)}</strong> is held in escrow —
            the creator starts only after that hold lands.
          </Text>
          {/* Deep-linked: this is the email that asks the brand to fund, and the
              fund button is on this page. */}
          <Cta
            href={appUrl(`/campaigns/${payload.campaignId}`)}
            label="Fund the campaign →"
          />
        </Layout>
      );

    case 'offer_declined':
      return (
        <Layout
          preview={`${payload.creatorHandle} passed on ${payload.campaignTitle}`}
          heading="A creator declined your offer"
        >
          <Text style={styles.text}>
            <strong>{payload.creatorHandle}</strong> declined your offer for{' '}
            {payload.campaignTitle}.
          </Text>
          {/* Says the same thing `offer_expired` does about the money, because
              the money did the same thing. The sentence above is where the two
              differ, and it is the one the brand acts on. No reason is given —
              the creator was never asked for one, and inventing a neutral
              phrasing would read as if they had. */}
          <Text style={styles.text}>
            <strong>{formatEtb(payload.releasedAmount)}</strong> is back in your
            available budget and can be offered to another creator.
          </Text>
          <Cta
            href={appUrl(`/campaigns/${payload.campaignId}`)}
            label="Open the campaign →"
          />
        </Layout>
      );

    case 'metric_reminder':
      // KAN-57: the scheduler's second pass found this video still unmeasured
      // past its window (AC-027). The email names the deal and the one next
      // action; the numbers the brand sees stay "Metrics pending" until the
      // creator submits them (KAN-50).
      return (
        <Layout
          preview={`Metrics still pending for ${payload.campaignTitle}`}
          heading="Your engagement metrics are still pending"
        >
          <Text style={styles.text}>
            Your video for {payload.campaignTitle} was approved, but the
            engagement numbers have not been submitted yet.
          </Text>
          <Text style={styles.text}>
            The brand sees <strong>Metrics pending</strong> until you record
            views, likes, shares and comments. Submitting them keeps the
            campaign dashboard accurate.
          </Text>
          {/* Deep-linked, the way the deal's own emails are: the pass names
              this creator's oldest overdue video, so the CTA lands on that
              deal rather than the inbox list they would have to search. The
              payload's `dealId` exists for exactly this. */}
          <Cta
            href={appUrl(`/creator/deals/${payload.dealId}`)}
            label="Submit your metrics →"
          />
        </Layout>
      );

    case 'tier_upgraded':
      // Phase 3: a stats refresh (manual or the weekly cron) qualified the
      // creator for a higher band. Only upgrades mail — a downgrade waits for
      // an admin decision and says nothing until one is made.
      return (
        <Layout
          preview={`Your refreshed stats earned the ${payload.tierName} tier`}
          heading={`You're now on the ${payload.tierName} tier`}
        >
          <Text style={styles.text}>
            Your refreshed TikTok stats qualify you for{' '}
            <strong>{payload.tierName}</strong>. Your price per video is now{' '}
            <strong>{formatEtb(payload.pricePerVideo)}</strong>.
          </Text>
          <Cta href={appUrl('/creator')} label="View your profile →" />
        </Layout>
      );
  }
}

function resolutionPhrase(
  resolution: NotificationPayloadMap['dispute_resolved']['resolution']
): string {
  switch (resolution) {
    case 'released':
      return 'released the payment to the creator';
    case 'refunded':
      return 'refunded the brand';
    case 'revision_requested':
      return 'asked for a revision';
  }
}

/**
 * `timestamptz` UTC (invariant 11) rendered for a human.
 *
 * Promoted to `lib/dates.ts` on KAN-39 at its second caller — the deal inbox
 * needs the same string, and importing it from here would drag
 * `@react-email/components` into the app bundle. Exactly why `formatEtb` moved
 * to `lib/money.ts` on KAN-24. Re-exported below, so anything importing it from
 * this module keeps working.
 */
const formatDate = formatDeadline;

/**
 * Render one notification to subject + html + text.
 *
 * The plain-text part is generated from the same tree rather than maintained
 * separately, so the two cannot disagree about what the email says.
 */
export async function renderNotification(
  input: NotificationInput
): Promise<EmailMessage> {
  const element = <Content {...input} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  const subject = (
    subjects[input.type] as (
      p: NotificationPayloadMap[typeof input.type]
    ) => string
  )(input.payload);

  return { subject, html, text };
}
