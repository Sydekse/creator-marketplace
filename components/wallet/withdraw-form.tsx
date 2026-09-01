'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  WITHDRAW_DIALOG_TITLE,
  WITHDRAW_LABEL,
  WITHDRAW_MIN_NOTE,
  WITHDRAW_TEST_MODE_HINT,
} from '@/lib/wallet/constants';

export interface WithdrawFormProps {
  /** Available balance in santim — the input's ceiling and its default. */
  availableSantim: number;
  formattedAvailable: string;
  /** "CBE ••••1234" — where the money will go, or null with no method yet. */
  methodSummary: string | null;
  /** True on a test key — renders the no-real-money hint. */
  testMode: boolean;
}

/**
 * The withdraw control (KAN-70 PR 3).
 *
 * Amount is typed in ETB and converted to santim at the boundary, mirroring
 * the Chapa client's own rule that santim live everywhere except the edge.
 * Every limit shown here is advisory — the route re-checks the minimum and
 * the serializable reserve re-checks the balance, so this form being wrong
 * can cost a round trip, never money.
 */
export function WithdrawForm({
  availableSantim,
  formattedAvailable,
  methodSummary,
  testMode,
}: WithdrawFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [amountEtb, setAmountEtb] = useState(
    (availableSantim / 100).toFixed(2)
  );

  const disabled = methodSummary === null || availableSantim < 10_000;

  async function handleWithdraw() {
    if (submitting) return;
    const parsed = Number.parseFloat(amountEtb);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Enter an amount in ETB.');
      return;
    }
    const santim = Math.round(parsed * 100);
    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch('/api/creator/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: santim }),
      });
    } catch {
      toast.error('Could not reach the server. Try again.');
      setSubmitting(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(body?.error?.message ?? 'Withdrawal failed — try again.');
      setSubmitting(false);
      // The balance may have moved under us (INSUFFICIENT_BALANCE) — show
      // the current truth rather than leaving a stale ceiling on screen.
      router.refresh();
      return;
    }

    toast.success('Withdrawal on its way — track it below.');
    setOpen(false);
    setSubmitting(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        {WITHDRAW_LABEL}
      </Button>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleWithdraw();
      }}
    >
      <p className="text-sm font-semibold text-brand-ink">
        {WITHDRAW_DIALOG_TITLE}
      </p>
      {methodSummary ? (
        <p className="text-sm text-muted-foreground">To: {methodSummary}</p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="withdraw-amount">Amount (ETB)</Label>
        <Input
          id="withdraw-amount"
          inputMode="decimal"
          value={amountEtb}
          onChange={(event) => setAmountEtb(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {WITHDRAW_MIN_NOTE} Available: {formattedAvailable}.
        </p>
      </div>
      {testMode ? (
        <p className="text-xs text-muted-foreground">
          {WITHDRAW_TEST_MODE_HINT}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? 'Sending…' : `${WITHDRAW_LABEL} now`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
