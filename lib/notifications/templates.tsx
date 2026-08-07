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
 * Re-exported so `lib/notifications/index.ts` keeps its surface and the KAN-54
 * tests that import it from there keep working. The implementation moved to
 * `lib/money.ts` on KAN-24 — see the note in that module for why.
 */
export { formatEtb };

const styles = {
  body: {
    backgroundColor: '#f6f6f7',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    margin: '32px auto',
    maxWidth: '520px',
    padding: '32px',
  },
  heading: { fontSize: '20px', fontWeight: 600, margin: '0 0 16px' },
  text: {
    color: '#333333',
    fontSize: '15px',
    lineHeight: '24px',
    margin: '0 0 12px',
  },
  muted: { color: '#6b7280', fontSize: '13px', lineHeight: '20px', margin: 0 },
  hr: { borderColor: '#e5e7eb', margin: '24px 0' },
  link: { color: '#111827', fontWeight: 600 },
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
          <Heading style={styles.heading}>{heading}</Heading>
          <Section>{children}</Section>
          <Hr style={styles.hr} />
          <Text style={styles.muted}>
            Creator Marketplace — you are receiving this because of activity on
            your account.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function Cta({ href, label }: { href: string; label: string }) {
  return (
    <Text style={styles.text}>
      <Link href={href} style={styles.link}>
        {label}
      </Link>
    </Text>
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
  payout_sent: (p) => `You have been paid for ${p.campaignTitle}`,
  dispute_resolved: (p) => `A decision was made on ${p.campaignTitle}`,
  offer_expired: (p) => `An offer for ${p.campaignTitle} expired`,
};

function Content({ type, payload }: NotificationInput): React.ReactElement {
  switch (type) {
    case 'offer_received':
      return (
        <Layout
          preview={`${payload.companyName} wants ${payload.videoCount} video(s)`}
          heading="You have a new offer"
        >
          <Text style={styles.text}>
            <strong>{payload.companyName}</strong> invited you to{' '}
            {payload.campaignTitle}.
          </Text>
          <Text style={styles.text}>
            {payload.videoCount} video{payload.videoCount === 1 ? '' : 's'} for{' '}
            <strong>{formatEtb(payload.totalPrice)}</strong> total, before the
            platform commission shown on the offer.
          </Text>
          <Text style={styles.text}>
            The offer expires on {formatDate(payload.offerExpiresAt)}. After
            that it is released automatically.
          </Text>
          <Cta href={appUrl('/creator/deals')} label="Review the offer →" />
        </Layout>
      );

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
          <Cta href={appUrl('/brand/campaigns')} label="Open the campaign →" />
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
          <Cta href={appUrl('/brand/campaigns')} label="Review the video →" />
        </Layout>
      );

    case 'deliverable_approved':
      return (
        <Layout
          preview="Your video was approved"
          heading="Your video was approved"
        >
          <Text style={styles.text}>
            Your video for {payload.campaignTitle} was approved.{' '}
            <strong>{formatEtb(payload.payout)}</strong> is on its way to you.
          </Text>
          <Cta href={appUrl('/creator/deals')} label="View the deal →" />
        </Layout>
      );

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
          <Text style={styles.text}>{payload.reason}</Text>
          <Text style={styles.text}>
            Your payment stays in escrow while you re-submit.
          </Text>
          <Cta href={appUrl('/creator/deals')} label="Submit a new video →" />
        </Layout>
      );

    case 'payout_sent':
      return (
        <Layout preview="You have been paid" heading="You have been paid">
          <Text style={styles.text}>
            <strong>{formatEtb(payload.payout)}</strong> was released to you for{' '}
            {payload.campaignTitle}, after the platform commission shown on the
            deal.
          </Text>
          <Cta href={appUrl('/creator/deals')} label="View the deal →" />
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
          <Cta href={appUrl('/brand/campaigns')} label="Open the campaign →" />
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
 * Explicitly UTC rather than the server's zone: a server-local render would
 * quietly change meaning when the deployment region does, and an offer deadline
 * that shifts by hours is worse than one that names its zone.
 */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

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
