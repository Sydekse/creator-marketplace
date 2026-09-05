'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarBlank } from '@phosphor-icons/react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { formatDeadlineUtc } from '@/lib/dates';
import {
  classifyPunctuality,
  deliveryTerm,
  PUNCTUALITY_LABELS,
} from '@/lib/deals/deadline';
import type { getDeadlineDetail } from '@/lib/deals/deadline-requests';

type Data = NonNullable<Awaited<ReturnType<typeof getDeadlineDetail>>>;
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
  return (
    <Card id="delivery-agreement">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarBlank aria-hidden />
          Delivery agreement
        </CardTitle>
        <CardDescription>
          {deliveryTerm(data.deliveryWindowDays)}. All ordered videos; each day
          is 24 elapsed hours. Offer expiry is separate.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="font-medium" role="status">
          {PUNCTUALITY_LABELS[outcome]}
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {data.originalDeliveryDueAt && (
            <div>
              <dt className="text-muted-foreground">
                Original delivery deadline
              </dt>
              <dd>{formatDeadlineUtc(data.originalDeliveryDueAt)}</dd>
            </div>
          )}
          {current && (
            <div>
              <dt className="text-muted-foreground">
                {data.firstDeliveredAt
                  ? 'Final agreed delivery deadline'
                  : 'Current delivery deadline'}
              </dt>
              <dd>{formatDeadlineUtc(data.dueAtFirstDelivery ?? current)}</dd>
            </div>
          )}
          {data.firstDeliveredAt && (
            <div>
              <dt className="text-muted-foreground">Initial delivery</dt>
              <dd>{formatDeadlineUtc(data.firstDeliveredAt)}</dd>
            </div>
          )}
        </dl>
        {data.missedDeliveryCommitment && (
          <p className="text-sm">
            An earlier deadline was missed before an extension was accepted.
            That commitment remains recorded.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Delivery timing is informational. It does not change payment, refund
          eligibility, revisions or final approval.
        </p>
        {pending && (
          <section
            className="flex flex-col gap-3 rounded-lg border p-4"
            aria-label="Pending extension"
          >
            <h3 className="font-medium">Extension pending — not yet agreed</h3>
            <p className="text-sm">
              Requested by {pending.proposerRole}:{' '}
              {formatDeadlineUtc(pending.proposedDueAt)}
            </p>
            <p className="text-sm whitespace-pre-wrap">{pending.note}</p>
            {canChange && (
              <div className="flex flex-wrap gap-2">
                {pending.proposedBy === userId ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => send('withdrawn')}
                  >
                    Withdraw extension
                  </Button>
                ) : (
                  <>
                    <Button disabled={busy} onClick={() => send('accepted')}>
                      Accept extension
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => send('rejected')}
                    >
                      Reject extension
                    </Button>
                  </>
                )}
              </div>
            )}
          </section>
        )}
        {canChange && !pending && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Request a delivery extension
            </summary>
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`due-${data.id}`}>
                    Proposed delivery deadline (UTC)
                  </FieldLabel>
                  <Input
                    id={`due-${data.id}`}
                    type="datetime-local"
                    required
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                  <FieldDescription>
                    Later than the current deadline and in the future. The other
                    party must agree.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`note-${data.id}`}>
                    Extension note
                  </FieldLabel>
                  <Textarea
                    id={`note-${data.id}`}
                    required
                    maxLength={2000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  Request extension
                </Button>
              </FieldGroup>
            </form>
          </details>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {data.requests.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Extension history ({data.requests.length})
            </summary>
            <ol className="mt-4 flex flex-col gap-4">
              {data.requests.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-col gap-1 border-l pl-4 text-sm"
                >
                  <p className="font-medium">
                    {request.status} · proposed by {request.proposerRole}
                    {request.decidedBy &&
                      ` · ${request.status} by ${request.status === 'withdrawn' ? request.proposerRole : request.proposerRole === 'brand' ? 'creator' : 'brand'}`}
                  </p>
                  <p>
                    {formatDeadlineUtc(request.previousDueAt)} →{' '}
                    {formatDeadlineUtc(request.proposedDueAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{request.note}</p>
                  <p className="text-xs text-muted-foreground">
                    Proposed {formatDeadlineUtc(request.proposedAt)}
                    {request.decidedAt &&
                      ` · ${request.status} ${formatDeadlineUtc(request.decidedAt)}`}
                    {request.closureReason &&
                      ` · ${request.closureReason === 'first_delivery' ? 'Initial delivery occurred' : 'Deal refunded'}`}
                  </p>
                  {request.status === 'accepted' &&
                    request.decidedAt &&
                    request.decidedAt > request.previousDueAt && (
                      <p>Earlier deadline missed before acceptance.</p>
                    )}
                </li>
              ))}
            </ol>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
