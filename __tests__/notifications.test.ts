import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ConsoleEmailProvider,
  EmailDeliveryError,
  InMemoryEmailProvider,
  NOTIFICATION_TYPES,
  RETRY_BACKOFF_MS,
  RedirectingEmailProvider,
  ResendEmailProvider,
  dispatchWithRetry,
  formatEtb,
  providerFromEnv,
  redactEmail,
  renderNotification,
} from '../lib/notifications';
import type { EmailMessage, NotificationType } from '../lib/notifications';
import { notifyWith, withNotifications } from '../lib/notifications/notify';
import type { NotifyDeps } from '../lib/notifications/notify';
import {
  LEGACY_SAMPLE_NOTIFICATIONS,
  SAMPLE_NOTIFICATIONS,
  allSamples,
} from '../lib/notifications/samples';
import { computeSplit } from '../lib/payment/ledger';

/**
 * KAN-54 — notification service (Tech Spec §5, PRD AC-018/029/030, NFR-010).
 *
 * The two criteria worth reading the tests for are AC-3 and AC-4, because they
 * constrain each other:
 *
 *   AC-3  an email failure must not roll back the domain transaction
 *   AC-4  a rolled-back domain transaction must not leave a sent email
 *
 * Either one alone is trivial to satisfy in a way that breaks the other, so
 * both are asserted on *ordering* and on *failure direction*, not just on
 * outcomes.
 */

const USER_ID = '11111111-2222-3333-4444-555555555555';
const RECIPIENT = 'creator@example.com';

// -- A database stub that records the order things happened in ---------------

interface Recorder {
  events: string[];
  rows: Array<{ userId: string; type: string; payload: unknown }>;
}

/**
 * Minimal stand-in for the drizzle surface this module touches.
 *
 * Hand-written rather than mocked so the *ordering* is observable: every write
 * and every commit lands in one array, which is what AC-4 is asserted on.
 */
function fakeDb(
  recorder: Recorder,
  options: { recipient?: string | null; failInTx?: boolean } = {}
) {
  const { recipient = RECIPIENT } = options;

  const insert = (viaTx: boolean) => () => ({
    // Synchronous on purpose: drizzle's builder chains `.values().returning()`
    // without awaiting `values`, so the fake must return the next link in the
    // chain rather than a promise of it.
    values: (row: { userId: string; type: string; payload: unknown }) => {
      recorder.events.push(viaTx ? 'insert(tx)' : 'insert(db)');
      recorder.rows.push(row);
      // `insertRow` reads the generated id back through `.returning()`, and
      // `flush` stamps `delivered_at` through that id.
      return {
        returning: async () => [{ id: `row-${recorder.rows.length}` }],
      };
    },
  });

  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => (recipient === null ? [] : [{ email: recipient }]),
      }),
    }),
  });

  // The post-dispatch `delivered_at` stamp (KAN-57 F3). Recorded as an event
  // so a test can assert the ordering: after `send`, and only on success.
  const update = () => ({
    set: () => ({
      where: async () => {
        recorder.events.push('stamp(deliveredAt)');
      },
    }),
  });

  return {
    insert: insert(false),
    select,
    update,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      recorder.events.push('begin');
      const tx = { insert: insert(true), select, update };
      try {
        const result = await cb(tx);
        recorder.events.push('commit');
        return result;
      } catch (error) {
        recorder.events.push('rollback');
        throw error;
      }
    },
  };
}

function deps(
  // `db` is deliberately re-declared as `unknown`, so the stub below can be
  // passed without every call site restating the cast.
  overrides: Omit<Partial<NotifyDeps>, 'db'> & {
    recorder: Recorder;
    db?: unknown;
  }
): NotifyDeps {
  const { recorder } = overrides;
  const provider = overrides.provider ?? new InMemoryEmailProvider();
  return {
    db: (overrides.db ?? fakeDb(recorder)) as NotifyDeps['db'],
    provider: {
      name: provider.name,
      send: async (to, message) => {
        recorder.events.push('send');
        return provider.send(to, message);
      },
    },
    render:
      overrides.render ??
      (async () => ({ subject: 's', html: '<p>h</p>', text: 't' })),
    log: overrides.log ?? { info: () => {}, error: () => {} },
    sleep: overrides.sleep ?? (async () => {}),
  };
}

function newRecorder(): Recorder {
  return { events: [], rows: [] };
}

// -- AC-2: every lifecycle point is covered ----------------------------------

describe('notification types', () => {
  /**
   * AC-2 enumerates nine lifecycle points. Asserting the list verbatim is the
   * only way "covers every lifecycle point" stays checkable — a type quietly
   * dropped during a refactor is otherwise invisible until the email that
   * should have been sent is not.
   *
   * The tenth, `offer_accepted`, is **not** one of AC-2's. It was added on
   * KAN-36, whose AC-8 requires the brand to be told when a creator accepts —
   * a point the PRD's list skips. Kept at the end so the nine above stay in
   * the order the AC gives them, and named here so the next person reads the
   * change as a deliberate addition rather than drift.
   */
  it('covers every AC-2 point except payout_sent, plus the deal-wave adds and KAN-57', () => {
    // `payout_sent` was dropped (KAN-55 review): it had no producer, and the
    // approval email already carries the money because payout is instant. Named
    // here so re-adding it (Q3 async settlement) reads as a deliberate change.
    // `metric_reminder` is the scheduler's second pass (KAN-57) — a new wave's
    // addition, so it is named at the end rather than reordered into the AC-2
    // nine.
    expect([...NOTIFICATION_TYPES]).toEqual([
      'offer_received',
      'verification_result',
      'campaign_funded',
      'deliverable_submitted',
      'deliverable_approved',
      'revision_requested',
      'dispute_resolved',
      'offer_expired',
      'offer_accepted',
      'offer_declined',
      'metric_reminder',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });
});

// -- Templates ---------------------------------------------------------------

/**
 * The fixtures live in `lib/notifications/samples.ts` (moved there on KAN-55).
 *
 * `scripts/preview-emails.ts` renders the same set to files so the templates can
 * be looked at without sending mail (AC-7), and two copies would drift — the copy
 * that drifted being the one nobody renders. The exhaustive mapped type that makes
 * a missing sample a compile error travels with the export.
 */
const SAMPLES = SAMPLE_NOTIFICATIONS;

describe('renderNotification', () => {
  it('has a sample for every type, so the cases below cannot silently shrink', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it.each(NOTIFICATION_TYPES)('renders %s', async (type) => {
    const message = await renderNotification(SAMPLES[type]);

    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.html).toContain('<html');
    // A missing text part is what gets transactional mail scored as spam.
    expect(message.text.trim().length).toBeGreaterThan(0);
  });

  it('renders the rejected branch of verification_result too', async () => {
    // The one type whose payload changes which email is produced, so the
    // `it.each` above only exercises half of it.
    const message = await renderNotification({
      type: 'verification_result',
      payload: {
        creatorProfileId: 'c1',
        outcome: 'rejected',
        reason: 'The handle did not match the account.',
      },
    });

    expect(message.subject).toBe('Your creator profile needs another look');
    expect(message.text).toContain('The handle did not match the account.');
  });

  it('names the brand on an offer, which is KAN-27 AC-3', async () => {
    const message = await renderNotification(SAMPLES.offer_received);
    expect(message.subject).toContain('Habesha Coffee');
    expect(message.text).toContain('Habesha Coffee');
  });

  it('formats money rather than printing raw santim', async () => {
    // 450_000 santim is 4,500 ETB. Printing the integer would tell a creator
    // they are being paid a hundred times too much.
    const message = await renderNotification(SAMPLES.offer_received);
    expect(message.text).toContain('4,500.00 ETB');
    expect(message.text).not.toContain('450000');
  });

  it('renders offer deadlines in UTC, not the server zone', async () => {
    // Invariant 11 stores timestamptz UTC. A server-local render would change
    // an offer deadline's meaning when the deployment region changed.
    const message = await renderNotification(SAMPLES.offer_received);
    expect(message.text).toContain('09:00');
  });

  /**
   * AC-5 / NFR-010. Emails leave our control the moment they are sent, so the
   * assertion is that nothing sensitive is in them in the first place.
   */
  it.each(NOTIFICATION_TYPES)(
    'puts no secret in the %s email',
    async (type) => {
      const message = await renderNotification(SAMPLES[type]);
      const body = `${message.subject} ${message.html} ${message.text}`;

      expect(body).not.toMatch(/re_[A-Za-z0-9]/); // Resend key shape
      expect(body).not.toMatch(/\btoken=|\bsecret\b|Bearer /i);
      // No credential smuggled into a link as a query parameter — every call to
      // action goes to a page behind the normal login.
      expect(body).not.toMatch(/https?:\/\/[^"\s]*\?[^"\s]*(token|key|sig)=/i);
    }
  );

  it('does not put the recipient address in the body', async () => {
    // The provider is told who separately; a template that also knew would be
    // a way for one user's address to end up in another's email.
    const message = await renderNotification(SAMPLES.offer_received);
    expect(message.html).not.toContain(RECIPIENT);
  });
});

// -- KAN-55 AC-3 / AC-4: the money emails explain the money ------------------

/**
 * The fixture's three figures, formatted. 450,000 santim gross at the
 * provisional 15% is 67,500 commission and 382,500 net.
 *
 * Written out rather than computed from `formatEtb` so a bug in the formatter
 * cannot make these assertions agree with a wrong render — the point is what a
 * creator reads, and a creator reads the string.
 */
const GROSS = '4,500.00 ETB';
const COMMISSION_LINE = '675.00 ETB';
const NET = '3,825.00 ETB';

/**
 * The email a creator is paid by. `deliverable_approved` is the one actually
 * sent — approval releases the money in the same transaction — so it is the
 * payout email and AC-4 is asserted on it. A separate `payout_sent` type was
 * dropped (KAN-55 review): it had no producer, and two emails seconds apart
 * would say one thing twice.
 */
const PAYMENT_TYPES = ['deliverable_approved'] as const;

/**
 * Every figure is checked in the **HTML and the plain text separately**.
 *
 * `renderNotification` builds both from one React tree, so they cannot disagree
 * about the words — but that is a claim about construction. A figure inside an
 * element `html-to-text` drops would be present in exactly one of the two, and
 * a plain-text part is what a mail client shows when images and CSS are off.
 * With no DOM environment in this repo this is the closest the suite gets to
 * reading the email.
 *
 * The label and its figure are only asserted *together* in the plain text: the
 * HTML renderer emits `Deal total: ` and `4,500.00 ETB` as separate nodes, so a
 * contiguous match there would assert an implementation detail of React's
 * server renderer rather than anything about the email.
 */
describe('money emails state gross, commission and net', () => {
  it.each(PAYMENT_TYPES)('%s shows the full breakdown', async (type) => {
    const message = await renderNotification(SAMPLE_NOTIFICATIONS[type]);

    for (const part of [message.html, message.text]) {
      expect(part).toContain(GROSS);
      expect(part).toContain(COMMISSION_LINE);
      expect(part).toContain(NET);
      expect(part).toContain('Deal total');
      expect(part).toContain('Less platform commission');
    }

    expect(message.text).toContain(`Deal total: ${GROSS}`);
    expect(message.text).toContain(
      `Less platform commission: ${COMMISSION_LINE}`
    );
    expect(message.text).toContain(`You receive: ${NET}`);
  });

  it('shows the creator what an offer would pay before they accept (AC-3)', async () => {
    const message = await renderNotification(
      SAMPLE_NOTIFICATIONS.offer_received
    );

    for (const part of [message.html, message.text]) {
      expect(part).toContain(GROSS);
      expect(part).toContain(COMMISSION_LINE);
      expect(part).toContain(NET);
    }
    // Video count and expiry are the other half of AC-3 and predate KAN-55;
    // asserted here so adding the breakdown cannot have displaced them.
    expect(message.text).toContain('3 videos');
    expect(message.text).toContain('1 Sept 2026, 09:00');
  });

  it('says "would receive" on an offer and "receive" on a payment', async () => {
    // An offer is a decision the creator has not made yet. Telling them they
    // receive the money states as settled the thing they are still weighing.
    const offer = await renderNotification(SAMPLE_NOTIFICATIONS.offer_received);
    const paid = await renderNotification(
      SAMPLE_NOTIFICATIONS.deliverable_approved
    );

    expect(offer.text).toContain('You would receive');
    expect(paid.text).toContain('You receive');
    expect(paid.text).not.toContain('would receive');
  });

  it('states the same net the ledger would pay, not its own arithmetic', () => {
    // The template does no arithmetic — `splitOf` refuses a partial payload
    // rather than filling a gap by subtraction. This asserts the fixture the
    // renders above are read from is itself what `computeSplit` produces, so a
    // breakdown that looked internally consistent could not be quoting figures
    // no ledger entry would ever be written from.
    const { totalPrice, commission, payout } =
      SAMPLE_NOTIFICATIONS.offer_received.payload;
    const split = computeSplit(totalPrice, '15.00');

    expect(split).toEqual({ commission: 67_500, payout: 382_500 });
    expect(commission).toBe(split.commission);
    expect(payout).toBe(split.payout);
    // The three reconcile exactly — `computeSplit` derives the payout by
    // subtraction from the basis points, so there is no rounding gap to hide.
    expect(split.commission + split.payout).toBe(totalPrice);
  });
});

/**
 * The other half of Nate's call on back-compatibility: **old rows render with
 * what they have.**
 *
 * Every notification is also stored as a `notification.payload` jsonb row, and
 * the rows already in the table — including the ones from the end-to-end
 * walkthrough — carry only the net figure. The new fields are therefore optional
 * and every money template branches. A zero or a blank beside a money figure
 * would be a false statement about money; leaving the line out is not.
 *
 * This is the branch every historical row takes, so it is the branch most likely
 * to be seen and least likely to be looked at.
 */
describe('a payload written before the breakdown existed', () => {
  const legacy = (type: NotificationType) => {
    const found = LEGACY_SAMPLE_NOTIFICATIONS.find((s) => s.type === type);
    if (!found) throw new Error(`no legacy sample for ${type}`);
    return found;
  };

  /**
   * The one figure each older payload does carry, which differs by email: an
   * offer stored the gross and a payment stored the net. Asserting the right one
   * per type is the difference between "the fallback renders" and "the fallback
   * renders the number it has".
   */
  const ONLY_FIGURE: Record<string, string> = {
    offer_received: GROSS,
    deliverable_approved: NET,
  };

  it.each(['offer_received', ...PAYMENT_TYPES] as const)(
    'renders %s with one figure and no gaps',
    async (type) => {
      const message = await renderNotification(legacy(type));

      for (const part of [message.html, message.text]) {
        expect(part).toContain(ONLY_FIGURE[type]);
        // Not a partial breakdown: the lines it has no numbers for are absent
        // rather than empty.
        expect(part).not.toContain('Less platform commission');
        expect(part).not.toContain('Deal total');
        // The two ways a missing optional number leaks into a render.
        expect(part).not.toContain('NaN');
        expect(part).not.toContain('undefined');
        // A money figure that is exactly zero. The lookbehind matters: every
        // figure here ends in `00 ETB`, so a bare `0.00 ETB` substring check
        // would match `4,500.00 ETB` and pass for the wrong reason.
        expect(part).not.toMatch(/(?<![\d,])0\.00 ETB/);
      }
    }
  );

  it('keeps the sentence that explained the commission in words', async () => {
    // Without the breakdown this clause is the only thing telling a creator the
    // figure is net. Deleting it while the fallback exists would leave the older
    // rows stating a number with no indication of what it is net of.
    const message = await renderNotification(legacy('deliverable_approved'));
    expect(message.text).toContain('after the platform commission');
  });

  it('links the campaign list when an expiry has no campaign to link (AC-2)', async () => {
    // The sweep now puts `campaignId` on the payload, so new mail deep-links.
    // Older rows have nothing to build a URL from, and a link to `/campaigns/`
    // with the id missing would be a 404 rather than a degraded link.
    const current = await renderNotification(
      SAMPLE_NOTIFICATIONS.offer_expired
    );
    const old = await renderNotification(legacy('offer_expired'));

    expect(current.text).toContain('/campaigns/ca1');
    expect(old.text).toContain('/campaigns');
    expect(old.text).not.toMatch(/\/campaigns\/(\s|$|")/);
  });
});

// -- KAN-55 AC-7: previewable locally ----------------------------------------

/**
 * "Previewable locally without sending real email." Before this there was no way
 * to look at one of these at all — `ConsoleEmailProvider` logs the recipient and
 * the subject and discards the body.
 *
 * What is asserted here is *coverage*, not appearance: that the preview set
 * cannot fall behind the templates. Whether the copy reads well is a human
 * check, and `npm run email:preview` is the thing that makes it possible.
 */
describe('the preview set covers every email', () => {
  it('renders one of every notification type', () => {
    const labels = allSamples().map((s) => s.label);

    for (const type of NOTIFICATION_TYPES) {
      expect(labels).toContain(type);
    }
  });

  it('renders the fallback branch of every template that has one', () => {
    // A branch nobody previews is a branch nobody has looked at, and this is the
    // branch every row written before KAN-55 takes.
    const labels = allSamples().map((s) => s.label);

    for (const type of ['offer_received', ...PAYMENT_TYPES, 'offer_expired']) {
      expect(labels).toContain(`${type}--legacy`);
    }
  });

  it('produces a subject, an HTML part and a text part for each', async () => {
    for (const { label, input } of allSamples()) {
      const message = await renderNotification(input);

      expect(message.subject.length, label).toBeGreaterThan(0);
      expect(message.html, label).toContain('<html');
      expect(message.text.trim().length, label).toBeGreaterThan(0);
    }
  });

  it('gives every sample a distinct label, so no preview overwrites another', () => {
    const labels = allSamples().map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

/**
 * Structural half of AC-7: the preview is *reachable*.
 *
 * Rendering to files is worth nothing if nobody can find the command, and this
 * repo has shipped correct, tested code that nothing invoked more than once. So
 * these read the source: the npm script exists, it points at the file that is
 * actually there, the script renders through the real template module rather
 * than a copy of it, and the output is gitignored.
 */
describe('the preview is wired up, not just written', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

  /**
   * Source with the comments taken out.
   *
   * Two of the assertions below are about what the code *does*, and both of
   * those words appear in a docstring explaining why the code does not do it —
   * `templates.tsx` names `totalPrice - commission` as the thing it never
   * computes, and the preview script explains that reading an email used to mean
   * configuring Resend. A guard that read the prose would fail on the comment
   * that documents it, and the fix would be to delete the explanation.
   *
   * `//` preceded by a colon is left alone so `http://localhost:3000` survives.
   */
  const code = (path: string) =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const PKG = read('package.json');
  const SCRIPT = read('scripts/preview-emails.ts');
  const GITIGNORE = read('.gitignore');
  const SCRIPT_CODE = code('scripts/preview-emails.ts');
  const TEMPLATE_CODE = code('lib/notifications/templates.tsx');

  it('read the files it asserts on', () => {
    // Non-vacuity. A path typo would make every assertion below pass against an
    // empty string, and `readFileSync` on a missing file throws — so the length
    // check is what proves these are the real files.
    for (const source of [PKG, SCRIPT, GITIGNORE, SCRIPT_CODE, TEMPLATE_CODE]) {
      expect(source.length).toBeGreaterThan(50);
    }
    // And it would fail if pointed at something that is not the file: the
    // renamed-path direction of the same guard.
    expect(() => read('scripts/preview-email.ts')).toThrow();
  });

  it('strips comments without eating code', () => {
    // Non-vacuity for the stripper itself: the two assertions that depend on it
    // would pass against an over-eager one that returned almost nothing.
    expect(TEMPLATE_CODE).toContain('export async function renderNotification');
    expect(TEMPLATE_CODE).toContain("'http://localhost:3000'");
    expect(TEMPLATE_CODE).not.toContain('a second source for a split');
    expect(SCRIPT_CODE).toContain('writeFileSync');
    expect(SCRIPT_CODE).not.toContain('configure Resend');
  });

  it('exposes the command as npm run email:preview', () => {
    expect(JSON.parse(PKG).scripts['email:preview']).toBe(
      'tsx scripts/preview-emails.ts'
    );
  });

  it('renders through the real templates, not a copy of them', () => {
    // A preview built from its own copy of the markup would show something no
    // recipient receives, which is worse than no preview.
    expect(SCRIPT).toMatch(
      /import \{ renderNotification \} from '\.\.\/lib\/notifications\/templates'/
    );
    expect(SCRIPT).toMatch(
      /import \{ allSamples \} from '\.\.\/lib\/notifications\/samples'/
    );
  });

  it('writes both parts of every email', () => {
    // AC-5's only real evidence in a repo with no DOM environment is someone
    // opening the text file.
    expect(SCRIPT).toContain('message.html');
    expect(SCRIPT).toContain('message.text');
  });

  it('touches neither the database nor the network', () => {
    // It imports fixtures and templates and writes files. A script that needed a
    // `DATABASE_URL` or a Resend key would not be "without sending real email".
    expect(SCRIPT_CODE).not.toMatch(/from '\.\.\/db/);
    expect(SCRIPT_CODE).not.toMatch(/resend|providerFromEnv|EMAIL_SEND/i);
  });

  it('keeps the rendered output out of git', () => {
    expect(GITIGNORE).toContain('.email-preview/');
  });

  it('does no money arithmetic in the templates', () => {
    // The rule the breakdown helper documents: a template that computed
    // `totalPrice - commission` would become a second source for a split
    // `computeSplit` owns, and the two could disagree on a rounding. The
    // fallback branch exists precisely so a gap is never filled by subtraction.
    expect(TEMPLATE_CODE).not.toMatch(/totalPrice\s*-/);
    expect(TEMPLATE_CODE).not.toMatch(
      /-\s*(payload|split)\.(commission|payout)/
    );
    expect(TEMPLATE_CODE).not.toMatch(/computeSplit|COMMISSION_RATE/);
  });
});

describe('formatEtb', () => {
  it.each([
    [0, '0.00 ETB'],
    [1, '0.01 ETB'],
    [99, '0.99 ETB'],
    [100, '1.00 ETB'],
    [150_000, '1,500.00 ETB'],
    [450_000, '4,500.00 ETB'],
    [100_000_000, '1,000,000.00 ETB'],
  ])('formats %i santim as %s', (santim, expected) => {
    expect(formatEtb(santim)).toBe(expected);
  });

  it('pads the santim part, so 5 santim is not shown as 0.5 ETB', () => {
    expect(formatEtb(5)).toBe('0.05 ETB');
  });

  it('handles negatives without losing the sign', () => {
    expect(formatEtb(-150_000)).toBe('−1,500.00 ETB');
  });

  it('never introduces a fractional santim', () => {
    // Invariant 4: amounts are integers. Division for display must not
    // reintroduce a float artifact.
    for (const santim of [1, 33, 3333, 123_456_789]) {
      expect(formatEtb(santim)).toMatch(/^\d{1,3}(,\d{3})*\.\d{2} ETB$/);
    }
  });
});

// -- NFR-010: redaction ------------------------------------------------------

describe('redactEmail', () => {
  it('keeps the domain and hides the person', () => {
    // The domain is the diagnostic half — "everything to this domain bounces"
    // is the thing a log is for. The local part is the identifying half.
    expect(redactEmail('natnael@example.com')).toBe('n*****l@example.com');
  });

  it('keeps two different addresses at one domain distinguishable', () => {
    expect(redactEmail('alice@example.com')).not.toBe(
      redactEmail('brian@example.com')
    );
  });

  it.each([
    ['ab@x.com', '**@x.com'],
    ['a@x.com', '*@x.com'],
  ])(
    'redacts the whole local part when it is too short to mask (%s)',
    (input, expected) => {
      expect(redactEmail(input)).toBe(expected);
    }
  );

  it.each(['', 'not-an-email', '@example.com', 'user@'])(
    'redacts %s entirely rather than guessing',
    (input) => {
      // An unparseable value here is more likely to be unexpected user data
      // than something safe to print.
      expect(redactEmail(input)).toBe('[redacted]');
    }
  );
});

// -- AC-3 / AC-7: bounded retry ----------------------------------------------

describe('dispatchWithRetry', () => {
  const message: EmailMessage = { subject: 's', html: '<p>h</p>', text: 't' };

  function log() {
    const lines: string[] = [];
    return {
      lines,
      info: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    };
  }

  it('sends once when the provider works', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'e1' });
    const result = await dispatchWithRetry(RECIPIENT, message, {
      provider: { name: 'test', send },
      sleep: async () => {},
      log: log(),
    });

    expect(result).toEqual({ ok: true, attempts: 1, id: 'e1' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and reports the attempt it succeeded on', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new EmailDeliveryError('503', false))
      .mockResolvedValue({ id: 'e1' });

    const result = await dispatchWithRetry(RECIPIENT, message, {
      provider: { name: 'test', send },
      sleep: async () => {},
      log: log(),
    });

    expect(result).toEqual({ ok: true, attempts: 2, id: 'e1' });
  });

  it('backs off using the declared schedule', async () => {
    const slept: number[] = [];
    const send = vi
      .fn()
      .mockRejectedValue(new EmailDeliveryError('503', false));

    await dispatchWithRetry(RECIPIENT, message, {
      provider: { name: 'test', send },
      sleep: async (ms) => {
        slept.push(ms);
      },
      log: log(),
    });

    expect(slept).toEqual([...RETRY_BACKOFF_MS]);
  });

  it('stops at the bounded attempt count rather than retrying forever (AC-7)', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new EmailDeliveryError('503', false));

    const result = await dispatchWithRetry(RECIPIENT, message, {
      provider: { name: 'test', send },
      sleep: async () => {},
      log: log(),
    });

    expect(result).toEqual({
      ok: false,
      attempts: RETRY_BACKOFF_MS.length + 1,
      reason: 'exhausted',
    });
    expect(send).toHaveBeenCalledTimes(RETRY_BACKOFF_MS.length + 1);
  });

  it('abandons a permanent failure on the first attempt (AC-7)', async () => {
    // Retrying a malformed address only delays the same answer, and spends the
    // budget a genuinely transient failure would have needed.
    const send = vi
      .fn()
      .mockRejectedValue(new EmailDeliveryError('bad address', true));

    const result = await dispatchWithRetry(RECIPIENT, message, {
      provider: { name: 'test', send },
      sleep: async () => {},
      log: log(),
    });

    expect(result).toEqual({ ok: false, attempts: 1, reason: 'permanent' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever the provider does (AC-3)', async () => {
    // The money path calls this. It is not allowed to be the reason a payout
    // fails.
    const send = vi.fn().mockRejectedValue(new Error('unexpected'));

    await expect(
      dispatchWithRetry(RECIPIENT, message, {
        provider: { name: 'test', send },
        sleep: async () => {},
        log: log(),
      })
    ).resolves.toMatchObject({ ok: false });
  });

  it('treats an unrecognised throw as transient', async () => {
    // A plain Error is most likely the network. Assuming permanence would drop
    // mail that a retry would have delivered.
    const send = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const result = await dispatchWithRetry(RECIPIENT, message, {
      provider: { name: 'test', send },
      sleep: async () => {},
      log: log(),
    });

    expect(result.attempts).toBe(RETRY_BACKOFF_MS.length + 1);
  });

  it('never writes an unredacted address to the log (NFR-010)', async () => {
    const logger = log();
    const send = vi
      .fn()
      .mockRejectedValue(new EmailDeliveryError('503', false));

    await dispatchWithRetry(RECIPIENT, message, {
      provider: { name: 'test', send },
      sleep: async () => {},
      log: logger,
    });

    expect(logger.lines.length).toBeGreaterThan(0);
    for (const line of logger.lines) {
      expect(line).not.toContain(RECIPIENT);
    }
  });

  it('does not log the message body, which could be anything', async () => {
    const logger = log();
    const send = vi.fn().mockResolvedValue({ id: 'e1' });

    await dispatchWithRetry(
      RECIPIENT,
      { subject: 'SECRET-SUBJECT', html: 'SECRET-BODY', text: 'SECRET-TEXT' },
      { provider: { name: 'test', send }, sleep: async () => {}, log: logger }
    );

    for (const line of logger.lines) {
      expect(line).not.toContain('SECRET-BODY');
      expect(line).not.toContain('SECRET-TEXT');
    }
  });
});

// -- AC-6: provider selection ------------------------------------------------

describe('providerFromEnv', () => {
  const full = {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'x@y.com',
    EMAIL_SEND: 'true',
  };

  it('sends for real only when all three switches are set', () => {
    expect(providerFromEnv(full)).toBeInstanceOf(ResendEmailProvider);
  });

  it.each([
    ['no opt-in', { RESEND_API_KEY: 're_test', EMAIL_FROM: 'x@y.com' }],
    ['opt-in not exactly true', { ...full, EMAIL_SEND: '1' }],
    ['no api key', { EMAIL_FROM: 'x@y.com', EMAIL_SEND: 'true' }],
    ['no sender', { RESEND_API_KEY: 're_test', EMAIL_SEND: 'true' }],
    ['empty environment', {}],
  ])('stubs to console when %s', (_case, env) => {
    // The default has to be the one that cannot mail a real person (AC-6).
    expect(providerFromEnv(env)).toBeInstanceOf(ConsoleEmailProvider);
  });

  it('redirects to a test inbox when one is configured', () => {
    const provider = providerFromEnv({
      ...full,
      EMAIL_TEST_INBOX: 'inbox@test.com',
    });
    expect(provider).toBeInstanceOf(RedirectingEmailProvider);
  });

  it('redirects even when sending is stubbed, rather than only when live', () => {
    const provider = providerFromEnv({ EMAIL_TEST_INBOX: 'inbox@test.com' });
    expect(provider).toBeInstanceOf(RedirectingEmailProvider);
  });
});

describe('RedirectingEmailProvider', () => {
  it('sends to the inbox, not the real recipient (AC-6)', async () => {
    const inner = new InMemoryEmailProvider();
    const provider = new RedirectingEmailProvider(inner, 'inbox@test.com');

    await provider.send(RECIPIENT, {
      subject: 'Offer',
      html: '<p>h</p>',
      text: 't',
    });

    expect(inner.sent[0].to).toBe('inbox@test.com');
  });

  it('keeps the intended recipient traceable without printing it (NFR-010)', async () => {
    // Redirected mail is useless if you cannot tell who it was meant for — but
    // this subject goes to a shared inbox and into every log line that quotes a
    // subject, so it carries the redacted form rather than the address. The
    // domain survives, which is the half a "why is this bouncing" question needs.
    const inner = new InMemoryEmailProvider();
    const provider = new RedirectingEmailProvider(inner, 'inbox@test.com');

    await provider.send(RECIPIENT, { subject: 'Offer', html: '', text: '' });

    const { subject } = inner.sent[0].message;
    expect(subject).toBe(`[to: ${redactEmail(RECIPIENT)}] Offer`);
    expect(subject).not.toContain(RECIPIENT);
    expect(subject).toContain('@example.com');
    // The original subject is still on the end, or the redirect would have
    // destroyed the thing that makes a redirected inbox readable at all.
    expect(subject).toMatch(/ Offer$/);
  });

  it('redacts the recipient in the subject for every provider it wraps', async () => {
    // Two different addresses at one domain stay distinguishable in the inbox,
    // which is what makes the redacted form usable rather than merely safe.
    const inner = new InMemoryEmailProvider();
    const provider = new RedirectingEmailProvider(inner, 'inbox@test.com');

    for (const to of ['alice@example.com', 'brian@example.com']) {
      await provider.send(to, { subject: 'Offer', html: '', text: '' });
    }

    const [first, second] = inner.sent.map((s) => s.message.subject);
    expect(first).not.toBe(second);
    expect(`${first} ${second}`).not.toMatch(/alice|brian/);
  });
});

describe('ResendEmailProvider', () => {
  const message: EmailMessage = { subject: 's', html: '<p>h</p>', text: 't' };

  function client(response: unknown) {
    return {
      emails: { send: vi.fn().mockResolvedValue(response) },
    } as unknown as ConstructorParameters<typeof ResendEmailProvider>[0];
  }

  it('returns the provider id on success', async () => {
    const provider = new ResendEmailProvider(
      client({ data: { id: 'resend-1' }, error: null }),
      'from@x.com'
    );
    await expect(provider.send(RECIPIENT, message)).resolves.toEqual({
      id: 'resend-1',
    });
  });

  /**
   * Resend reports API failures in the response body rather than by throwing,
   * so a `send` that "succeeded" can have delivered nothing. Missing this
   * branch is how an email service silently stops working.
   */
  it('treats an error in the response body as a failure', async () => {
    const provider = new ResendEmailProvider(
      client({
        data: null,
        error: { name: 'validation_error', statusCode: 422 },
      }),
      'from@x.com'
    );

    await expect(provider.send(RECIPIENT, message)).rejects.toBeInstanceOf(
      EmailDeliveryError
    );
  });

  it.each([
    [422, true],
    [403, true],
    [401, true],
    [500, false],
    [502, false],
    [429, false],
  ])('marks status %i permanent=%s', async (statusCode, permanent) => {
    // 429 is deliberately transient: rate limiting is exactly what retry is
    // for, and treating it as permanent would drop mail during a burst.
    const provider = new ResendEmailProvider(
      client({ data: null, error: { name: 'e', statusCode } }),
      'from@x.com'
    );

    await expect(provider.send(RECIPIENT, message)).rejects.toMatchObject({
      permanent,
    });
  });

  it('treats a thrown request error as transient', async () => {
    const provider = new ResendEmailProvider(
      {
        emails: { send: vi.fn().mockRejectedValue(new Error('ECONNRESET')) },
      } as unknown as ConstructorParameters<typeof ResendEmailProvider>[0],
      'from@x.com'
    );

    await expect(provider.send(RECIPIENT, message)).rejects.toMatchObject({
      permanent: false,
    });
  });
});

// -- AC-1, AC-3, AC-4: the entry point and the commit boundary ---------------

describe('withNotifications', () => {
  it('writes the notification row inside the transaction', async () => {
    const recorder = newRecorder();

    await withNotifications(async (_tx, notify) => {
      await notify(USER_ID, 'deliverable_approved', {
        dealId: 'd1',
        campaignTitle: 'C',
        payout: 1000,
      });
    }, deps({ recorder }));

    // Not `insert(db)` — a row written outside the transaction would survive a
    // rollback, which is exactly what AC-4 forbids.
    expect(recorder.events).toContain('insert(tx)');
    expect(recorder.events).not.toContain('insert(db)');
  });

  /**
   * AC-4, stated as an ordering. This is the assertion that would fail if
   * someone "simplified" the service by sending inside the transaction.
   */
  it('dispatches only after the transaction commits', async () => {
    const recorder = newRecorder();

    await withNotifications(async (_tx, notify) => {
      await notify(USER_ID, 'deliverable_approved', {
        dealId: 'd1',
        campaignTitle: 'C',
        payout: 1000,
      });
    }, deps({ recorder }));

    expect(recorder.events).toEqual([
      'begin',
      'insert(tx)',
      'commit',
      'send',
      'stamp(deliveredAt)',
    ]);
  });

  /**
   * The F3 fix, stated as an ordering. A successful dispatch stamps
   * `delivered_at` *after* commit — delivery bookkeeping that can never roll
   * back the domain transaction it belongs to.
   */
  it('stamps delivered_at after a successful dispatch', async () => {
    const recorder = newRecorder();

    await withNotifications(async (_tx, notify) => {
      await notify(USER_ID, 'deliverable_approved', {
        dealId: 'd1',
        campaignTitle: 'C',
        payout: 1000,
      });
    }, deps({ recorder }));

    expect(recorder.events).toEqual([
      'begin',
      'insert(tx)',
      'commit',
      'send',
      'stamp(deliveredAt)',
    ]);
  });

  /**
   * F3's other direction. A failed dispatch leaves the row unstamped, so the
   * metric-reminder guard reads "never told" and the next run tries again —
   * the creator is not silenced for a whole interval by a mail they never got.
   * The caller still succeeds: the stamp is bookkeeping, not part of the
   * domain result (AC-3).
   */
  it('leaves delivered_at unstamped when dispatch fails', async () => {
    const recorder = newRecorder();
    const failing = {
      name: 'failing',
      send: vi.fn().mockRejectedValue(new EmailDeliveryError('503', false)),
    };

    await expect(
      withNotifications(
        async (_tx, notify) => {
          await notify(USER_ID, 'deliverable_approved', {
            dealId: 'd1',
            campaignTitle: 'C',
            payout: 1000,
          });
          return 'domain result';
        },
        deps({ recorder, provider: failing })
      )
    ).resolves.toBe('domain result');

    expect(recorder.events).toContain('commit');
    expect(recorder.events).not.toContain('stamp(deliveredAt)');
  });

  it('sends nothing when the domain transaction fails (AC-4)', async () => {
    const recorder = newRecorder();
    const provider = new InMemoryEmailProvider();

    await expect(
      withNotifications(async (_tx, notify) => {
        await notify(USER_ID, 'deliverable_approved', {
          dealId: 'd1',
          campaignTitle: 'C',
          payout: 1000,
        });
        throw new Error('domain rule violated');
      }, deps({ recorder, provider }))
    ).rejects.toThrow('domain rule violated');

    expect(recorder.events).toContain('rollback');
    expect(recorder.events).not.toContain('send');
    expect(provider.sent).toHaveLength(0);
  });

  it('propagates the domain failure unchanged', async () => {
    // The caller's error handling keys off its own error type; wrapping it here
    // would turn a known failure into an unknown one.
    const recorder = newRecorder();
    class DomainError extends Error {}

    await expect(
      withNotifications(async () => {
        throw new DomainError('nope');
      }, deps({ recorder }))
    ).rejects.toBeInstanceOf(DomainError);
  });

  /**
   * AC-3, the other direction. A committed transaction stays committed even if
   * every email fails — otherwise an email outage becomes a payout outage.
   */
  it('does not fail the caller when dispatch fails', async () => {
    const recorder = newRecorder();
    const failing = {
      name: 'failing',
      send: vi.fn().mockRejectedValue(new EmailDeliveryError('503', false)),
    };

    await expect(
      withNotifications(
        async (_tx, notify) => {
          await notify(USER_ID, 'deliverable_approved', {
            dealId: 'd1',
            campaignTitle: 'C',
            payout: 1000,
          });
          return 'domain result';
        },
        deps({ recorder, provider: failing })
      )
    ).resolves.toBe('domain result');

    expect(recorder.events).toContain('commit');
  });

  it('does not fail the caller when rendering throws', async () => {
    const recorder = newRecorder();

    await expect(
      withNotifications(
        async (_tx, notify) => {
          await notify(USER_ID, 'deliverable_approved', {
            dealId: 'd1',
            campaignTitle: 'C',
            payout: 1000,
          });
          return 'ok';
        },
        deps({
          recorder,
          render: async () => {
            throw new Error('template blew up');
          },
        })
      )
    ).resolves.toBe('ok');
  });

  it('returns the value the transaction produced', async () => {
    const recorder = newRecorder();
    await expect(
      withNotifications(async () => 42, deps({ recorder }))
    ).resolves.toBe(42);
  });

  it('delivers every notification raised in one transaction', async () => {
    // A funded campaign notifies each creator; dropping all but the first is a
    // plausible bug that only a multi-notify test catches.
    const recorder = newRecorder();
    const provider = new InMemoryEmailProvider();

    await withNotifications(async (_tx, notify) => {
      await notify(USER_ID, 'offer_received', SAMPLES.offer_received.payload);
      await notify(USER_ID, 'campaign_funded', SAMPLES.campaign_funded.payload);
    }, deps({ recorder, provider }));

    expect(recorder.rows.map((r) => r.type)).toEqual([
      'offer_received',
      'campaign_funded',
    ]);
    expect(recorder.events.filter((e) => e === 'send')).toHaveLength(2);
  });

  it('carries on when one recipient of a batch cannot be resolved', async () => {
    // One deleted user must not stop the rest of a campaign's mail.
    const recorder = newRecorder();
    const db = fakeDb(recorder, { recipient: null });

    await expect(
      withNotifications(async (_tx, notify) => {
        await notify(USER_ID, 'deliverable_approved', {
          dealId: 'd1',
          campaignTitle: 'C',
          payout: 1000,
        });
      }, deps({ recorder, db }))
    ).resolves.toBeUndefined();

    // The row is still there — the user sees it in-app on next login.
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.events).not.toContain('send');
  });

  it('stores the payload on the row, so the in-app notice can render', async () => {
    const recorder = newRecorder();

    await withNotifications(async (_tx, notify) => {
      await notify(USER_ID, 'offer_expired', SAMPLES.offer_expired.payload);
    }, deps({ recorder }));

    expect(recorder.rows[0]).toEqual({
      userId: USER_ID,
      type: 'offer_expired',
      payload: SAMPLES.offer_expired.payload,
    });
  });
});

describe('notify (no transaction)', () => {
  it('writes the row and sends (AC-1)', async () => {
    const recorder = newRecorder();

    await notifyWith(deps({ recorder }), USER_ID, 'verification_result', {
      creatorProfileId: 'c1',
      outcome: 'approved',
    });

    expect(recorder.events).toEqual([
      'insert(db)',
      'send',
      'stamp(deliveredAt)',
    ]);
    expect(recorder.rows[0].type).toBe('verification_result');
  });

  it('still does not throw when the send fails', async () => {
    const recorder = newRecorder();
    const failing = {
      name: 'failing',
      send: vi.fn().mockRejectedValue(new EmailDeliveryError('503', false)),
    };

    await expect(
      notifyWith(
        deps({ recorder, provider: failing }),
        USER_ID,
        'verification_result',
        { creatorProfileId: 'c1', outcome: 'approved' }
      )
    ).resolves.toBeUndefined();
  });
});

// -- Structural: the console provider is the default -------------------------

describe('nothing mails a real person by default', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL('../lib/notifications/providers.ts', import.meta.url)
    ),
    'utf8'
  );

  it('requires an explicit opt-in constant, not just a key being present', () => {
    // Asserted at source level because the risk is a future edit relaxing the
    // condition, and every behavioural test above would still pass if the
    // opt-in were dropped in favour of "key is set".
    expect(source).toContain("env.EMAIL_SEND !== 'true'");
  });

  it('logs through the redactor even in the dev provider', () => {
    const consoleProvider = new ConsoleEmailProvider();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    return consoleProvider
      .send(RECIPIENT, { subject: 's', html: '', text: '' })
      .then(() => {
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0]).not.toContain(RECIPIENT);
        spy.mockRestore();
      });
  });
});
