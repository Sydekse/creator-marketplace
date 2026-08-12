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
import type {
  EmailMessage,
  NotificationInput,
  NotificationType,
} from '../lib/notifications';
import { notifyWith, withNotifications } from '../lib/notifications/notify';
import type { NotifyDeps } from '../lib/notifications/notify';

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
    values: async (row: { userId: string; type: string; payload: unknown }) => {
      recorder.events.push(viaTx ? 'insert(tx)' : 'insert(db)');
      recorder.rows.push(row);
    },
  });

  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => (recipient === null ? [] : [{ email: recipient }]),
      }),
    }),
  });

  return {
    insert: insert(false),
    select,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      recorder.events.push('begin');
      const tx = { insert: insert(true), select };
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
  it('covers the nine points AC-2 names, plus the two the deal wave adds', () => {
    expect([...NOTIFICATION_TYPES]).toEqual([
      'offer_received',
      'verification_result',
      'campaign_funded',
      'deliverable_submitted',
      'deliverable_approved',
      'revision_requested',
      'payout_sent',
      'dispute_resolved',
      'offer_expired',
      'offer_accepted',
      'offer_declined',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });
});

// -- Templates ---------------------------------------------------------------

const SAMPLES: {
  [K in NotificationType]: Extract<NotificationInput, { type: K }>;
} = {
  offer_received: {
    type: 'offer_received',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      companyName: 'Habesha Coffee',
      totalPrice: 450_000,
      videoCount: 3,
      offerExpiresAt: '2026-09-01T09:00:00.000Z',
    },
  },
  verification_result: {
    type: 'verification_result',
    payload: { creatorProfileId: 'c1', outcome: 'approved' },
  },
  campaign_funded: {
    type: 'campaign_funded',
    payload: {
      campaignId: 'ca1',
      campaignTitle: 'Spring Coffee Push',
      dealCount: 2,
      totalHeld: 900_000,
    },
  },
  deliverable_submitted: {
    type: 'deliverable_submitted',
    payload: {
      dealId: 'd1',
      deliverableId: 'dl1',
      campaignTitle: 'Spring Coffee Push',
    },
  },
  deliverable_approved: {
    type: 'deliverable_approved',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      payout: 382_500,
    },
  },
  revision_requested: {
    type: 'revision_requested',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      reason: 'Please show the packaging in the first three seconds.',
    },
  },
  payout_sent: {
    type: 'payout_sent',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      payout: 382_500,
    },
  },
  dispute_resolved: {
    type: 'dispute_resolved',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      resolution: 'refunded',
    },
  },
  offer_expired: {
    type: 'offer_expired',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      releasedAmount: 150_000,
    },
  },
  offer_accepted: {
    type: 'offer_accepted',
    payload: {
      dealId: 'd1',
      campaignId: 'ca1',
      campaignTitle: 'Spring Coffee Push',
      creatorHandle: '@selam',
      totalPrice: 450_000,
    },
  },
  offer_declined: {
    type: 'offer_declined',
    payload: {
      dealId: 'd1',
      campaignId: 'ca1',
      campaignTitle: 'Spring Coffee Push',
      creatorHandle: '@selam',
      releasedAmount: 450_000,
    },
  },
};

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

  it('keeps the intended recipient in the subject so it stays traceable', () => {
    // Redirected mail is useless if you cannot tell who it was meant for.
    const inner = new InMemoryEmailProvider();
    const provider = new RedirectingEmailProvider(inner, 'inbox@test.com');

    return provider
      .send(RECIPIENT, { subject: 'Offer', html: '', text: '' })
      .then(() => {
        expect(inner.sent[0].message.subject).toBe(`[to: ${RECIPIENT}] Offer`);
      });
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
      await notify(USER_ID, 'payout_sent', {
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
      await notify(USER_ID, 'payout_sent', {
        dealId: 'd1',
        campaignTitle: 'C',
        payout: 1000,
      });
    }, deps({ recorder }));

    expect(recorder.events).toEqual(['begin', 'insert(tx)', 'commit', 'send']);
  });

  it('sends nothing when the domain transaction fails (AC-4)', async () => {
    const recorder = newRecorder();
    const provider = new InMemoryEmailProvider();

    await expect(
      withNotifications(async (_tx, notify) => {
        await notify(USER_ID, 'payout_sent', {
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
          await notify(USER_ID, 'payout_sent', {
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
          await notify(USER_ID, 'payout_sent', {
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
        await notify(USER_ID, 'payout_sent', {
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

    expect(recorder.events).toEqual(['insert(db)', 'send']);
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
