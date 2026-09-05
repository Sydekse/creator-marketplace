'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatDeadlineUtc } from '@/lib/dates';
import {
  classifyPunctuality,
  deliveryTerm,
  PUNCTUALITY_LABELS,
} from '@/lib/deals/deadline';
import type { getDeadlineDetail } from '@/lib/deals/deadline-requests';

type Data = NonNullable<Awaited<ReturnType<typeof getDeadlineDetail>>>;

/**
 * The delivery agreement, in the v4 grammar (KAN-160): an uppercase kicker
 * with the punctuality verdict as a chip beside it, the deadlines as a
 * hairline-ruled mono fact ledger, the pending extension as an amber-railed
 * panel with its accept/reject/withdraw controls inline, and the request
 * form and history folded behind ghost-pill disclosures. All the decision
 * logic — who can change, what a decision PATCHes, the 409 refresh — is the
 * KAN-160 behavior unchanged; only the surface moved into the `.bd` layer.
 */
export function DeadlineCard({
  data,
  role,
  userId,
  now,
}: {
  data: Data;
  role: 'brand' | 'creator' | 'admin';
  userId: string;
  now: Date;
}) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = data.currentDeliveryDueAt;
  const canChange =
    role !== 'admin' &&
    data.status === 'funded' &&
    !data.firstDeliveredAt &&
    current != null;
  const pending =
    data.status === 'funded' && !data.firstDeliveredAt
      ? data.requests.find((r) => r.status === 'pending')
      : undefined;
  const outcome = classifyPunctuality(data, now);

  async function send(decision?: 'accepted' | 'rejected' | 'withdrawn') {
    if (!current) return;
    setError(null);
    let proposedDueAt;
    if (!decision) {
      const parsed = new Date(`${date}:00Z`);
      if (!Number.isFinite(parsed.getTime()) || !note.trim()) {
        setError('Choose a UTC date and time and explain the extension.');
        return;
      }
      proposedDueAt = parsed.toISOString();
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/deals/${data.id}/deadline`, {
        method: decision ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          decision
            ? {
                requestId: pending?.id,
                expectedDueAt: pending?.previousDueAt.toISOString(),
                decision,
              }
            : { expectedDueAt: current.toISOString(), proposedDueAt, note }
        ),
      });
      if (!response.ok) {
        const result = await response.json();
        setError(
          result.error?.message ??
            'The extension could not be saved. Refresh and try again.'
        );
        if (response.status === 409) router.refresh();
        return;
      }
      toast.success(
        decision
          ? `Delivery extension ${decision}.`
          : 'Delivery extension requested.'
      );
      setDate('');
      setNote('');
      router.refresh();
    } catch {
      setError(
        'Could not reach the server. Refresh to check whether the request was saved before retrying.'
      );
    } finally {
      setBusy(false);
    }
  }

  const onTime = outcome === 'on_time' || outcome === 'awaiting_funding';
  const effective = data.dueAtFirstDelivery ?? current;
  const moved =
    data.originalDeliveryDueAt &&
    effective &&
    data.originalDeliveryDueAt.getTime() !== effective.getTime();

  // Nothing recorded and nothing to do: one quiet line, not an empty card.
  if (!current && !data.originalDeliveryDueAt && data.requests.length === 0) {
    return (
      <p className="bd-agreeline" id="delivery-agreement">
        <span className="bd-agreekicker">Delivery agreement</span>
        {deliveryTerm(data.deliveryWindowDays)}. The deadline is set when the
        campaign is funded.
      </p>
    );
  }

  return (
    <section id="delivery-agreement" className="bd-agree">
      <div className="bd-agreehead">
        <span className="bd-agreekicker">Delivery agreement</span>
        <span
          className={
            onTime ? 'bd-agreeverdict' : 'bd-agreeverdict bd-agreeverdict--late'
          }
          role="status"
        >
          {PUNCTUALITY_LABELS[outcome]}
        </span>
      </div>

      {/* The one number this card exists for. */}
      {effective && (
        <div className="bd-agreehero">
          <span className="bd-agreehero-lab">
            {data.firstDeliveredAt
              ? 'Final agreed deadline'
              : 'Deliver everything by'}
          </span>
          <span className="bd-agreehero-num bd-mono">
            {formatDeadlineUtc(effective)}
          </span>
          <span className="bd-agreehero-sub">
            {deliveryTerm(data.deliveryWindowDays)} · each day is 24 elapsed
            hours · offer expiry is separate
            {moved &&
              ` · originally ${formatDeadlineUtc(data.originalDeliveryDueAt!)}`}
            {data.firstDeliveredAt &&
              ` · first delivered ${formatDeadlineUtc(data.firstDeliveredAt)}`}
          </span>
        </div>
      )}

      {data.missedDeliveryCommitment && (
        <p className="bd-agreemiss">
          An earlier deadline was missed before an extension was accepted. That
          commitment remains recorded.
        </p>
      )}

      {pending && (
        <div className="bd-agreepending" aria-label="Pending extension">
          <p className="bd-agreepending-title">
            Extension pending — not yet agreed
          </p>
          <p className="bd-agreepending-ask">
            {pending.proposedBy === userId
              ? 'You propose'
              : `The ${pending.proposerRole} proposes`}{' '}
            <b className="bd-mono">
              {formatDeadlineUtc(pending.proposedDueAt)}
            </b>
          </p>
          <p className="bd-agreepending-note">{pending.note}</p>
          {canChange && (
            <div className="bd-agreeacts">
              {pending.proposedBy === userId ? (
                <button
                  type="button"
                  className="bd-btn bd-btn--ghost"
                  disabled={busy}
                  onClick={() => send('withdrawn')}
                >
                  Withdraw extension
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="bd-btn bd-btn--primary"
                    disabled={busy}
                    onClick={() => send('accepted')}
                  >
                    Accept extension
                  </button>
                  <button
                    type="button"
                    className="bd-btn bd-btn--ghost"
                    disabled={busy}
                    onClick={() => send('rejected')}
                  >
                    Reject extension
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {canChange && !pending && (
        <details className="bd-agreefold">
          <summary>Request a delivery extension</summary>
          <form
            className="bd-agreeform"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="bd-agreefield">
              <span>Proposed delivery deadline (UTC)</span>
              <input
                type="datetime-local"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <small>
                Later than the current deadline and in the future. The other
                party must agree.
              </small>
            </label>
            <label className="bd-agreefield">
              <span>Extension note</span>
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="bd-btn bd-btn--primary"
              disabled={busy}
            >
              Request extension
            </button>
          </form>
        </details>
      )}

      {error && (
        <p role="alert" className="bd-agreeerror">
          {error}
        </p>
      )}

      {data.requests.length > 0 && (
        <details className="bd-agreefold">
          <summary>Extension history ({data.requests.length})</summary>
          <ol className="bd-agreelog">
            {data.requests.map((request) => (
              <li key={request.id}>
                <p className="bd-agreelog-line">
                  <b>{request.status}</b> · proposed by {request.proposerRole}
                </p>
                <p className="bd-agreelog-move bd-mono">
                  {formatDeadlineUtc(request.previousDueAt)} →{' '}
                  {formatDeadlineUtc(request.proposedDueAt)}
                </p>
                <p className="bd-agreelog-note">{request.note}</p>
                <p className="bd-agreelog-meta">
                  Proposed {formatDeadlineUtc(request.proposedAt)}
                  {request.decidedAt &&
                    ` · ${request.status} ${formatDeadlineUtc(request.decidedAt)}`}
                  {request.closureReason &&
                    ` · ${request.closureReason === 'first_delivery' ? 'Initial delivery occurred' : 'Deal refunded'}`}
                </p>
                {request.status === 'accepted' &&
                  request.decidedAt &&
                  request.decidedAt > request.previousDueAt && (
                    <p className="bd-agreelog-meta">
                      Earlier deadline missed before acceptance.
                    </p>
                  )}
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="bd-agreefoot">
        Delivery timing is informational. It does not change payment, refund
        eligibility, revisions or final approval.
      </p>
    </section>
  );
}
