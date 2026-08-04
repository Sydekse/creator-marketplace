import { Resend } from 'resend';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types';
import { EmailDeliveryError } from './types';
import { redactEmail } from './redact';

/**
 * Email providers, and the rule for picking one (KAN-54 AC-6).
 *
 * The default is the one that cannot mail a real person. Sending for real takes
 * a deliberate combination of env vars, so no branch, test run, or preview
 * deploy reaches a creator's inbox by forgetting something.
 */

/** Writes the email to the server log instead of sending it (AC-6). */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(to: string, message: EmailMessage): Promise<EmailSendResult> {
    // Redacted even here. This is the *dev* provider, but dev logs get pasted
    // into tickets and chat, and NFR-010 does not have an exception for that.
    console.log(
      `[email:console] to=${redactEmail(to)} subject=${JSON.stringify(message.subject)}`
    );
    return { id: null };
  }
}

/** Collects messages in memory. For tests, never wired into the app. */
export class InMemoryEmailProvider implements EmailProvider {
  readonly name = 'in-memory';
  readonly sent: Array<{ to: string; message: EmailMessage }> = [];

  async send(to: string, message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push({ to, message });
    return { id: `mem_${this.sent.length}` };
  }
}

/**
 * HTTP status codes where retrying cannot help (AC-7).
 *
 * 401/403 mean the API key is wrong, 422 that the address is malformed, 404
 * that the route or sender does not exist. None of those fix themselves, so
 * they are permanent and the attempt budget is left for failures that might.
 * 429 is deliberately absent — rate limiting is the transient case retry is
 * *for*.
 */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 422]);

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly client: Pick<Resend, 'emails'>,
    private readonly from: string
  ) {}

  async send(to: string, message: EmailMessage): Promise<EmailSendResult> {
    let response: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      response = await this.client.emails.send({
        from: this.from,
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (cause) {
      // A thrown error is the network layer, not the API — always worth another
      // attempt.
      throw new EmailDeliveryError('resend request failed', false, cause);
    }

    if (response.error) {
      // Resend reports API failures in the body rather than by throwing, so a
      // `send` that "succeeded" can still have delivered nothing. Missing this
      // branch is how an email service silently stops working.
      const status = statusOf(response.error);
      throw new EmailDeliveryError(
        `resend rejected the message: ${response.error.name}`,
        status !== null && PERMANENT_STATUSES.has(status),
        response.error
      );
    }

    return { id: response.data?.id ?? null };
  }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : null;
}

/**
 * Rewrites every recipient to one inbox, keeping the real address in the
 * subject so a redirected mail is still traceable (AC-6).
 *
 * This is the "routed to a test inbox" half of the AC — useful in preview
 * deploys, where the templates need real rendering through Resend but the
 * addresses belong to seeded demo users.
 */
export class RedirectingEmailProvider implements EmailProvider {
  readonly name: string;

  constructor(
    private readonly inner: EmailProvider,
    private readonly inbox: string
  ) {
    this.name = `redirect(${inner.name})`;
  }

  async send(to: string, message: EmailMessage): Promise<EmailSendResult> {
    return this.inner.send(this.inbox, {
      ...message,
      subject: `[to: ${to}] ${message.subject}`,
    });
  }
}

/**
 * Pick a provider from the environment.
 *
 * Real sending requires `RESEND_API_KEY` *and* `EMAIL_FROM` *and*
 * `EMAIL_SEND=true`. Three, not one, and the last is an explicit opt-in: a
 * preview deploy that inherits production secrets still will not send, because
 * inheriting a key is an accident and setting `EMAIL_SEND` is a decision.
 *
 * `EMAIL_TEST_INBOX` wraps whatever was chosen, so it can redirect real Resend
 * delivery without also having to be the thing that disables it.
 */
export function providerFromEnv(env: EmailEnv = process.env): EmailProvider {
  const base = baseProviderFromEnv(env);
  const inbox = env.EMAIL_TEST_INBOX;
  return inbox ? new RedirectingEmailProvider(base, inbox) : base;
}

/**
 * The four variables this reads, and nothing else.
 *
 * Narrower than `NodeJS.ProcessEnv` on purpose: `process.env` still satisfies
 * it, but the signature now says which variables decide the provider instead of
 * handing the whole environment to a function that reads four strings.
 */
export interface EmailEnv {
  // The index signature is what lets `process.env` satisfy this: a type whose
  // properties are all optional is otherwise rejected as a "weak type".
  [key: string]: string | undefined;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_SEND?: string;
  EMAIL_TEST_INBOX?: string;
}

function baseProviderFromEnv(env: EmailEnv): EmailProvider {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;

  if (env.EMAIL_SEND !== 'true' || !apiKey || !from) {
    return new ConsoleEmailProvider();
  }
  return new ResendEmailProvider(new Resend(apiKey), from);
}
