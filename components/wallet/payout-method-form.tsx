'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAYOUT_METHOD_SAVED } from '@/lib/wallet/constants';

export interface BankOption {
  code: string;
  name: string;
}

export interface PayoutMethodFormProps {
  banks: BankOption[];
  /** The saved method, masked — pre-fills nothing secret. */
  method: {
    bankCode: string;
    bankName: string;
    accountNumberMasked: string;
    accountName: string;
  } | null;
}

/**
 * Set or replace where withdrawals go (KAN-70 PR 3).
 *
 * The bank list arrives server-fetched from Chapa's `/banks`; the route
 * re-validates the code against the same list, so this form is a convenience,
 * not a gate. The account number field never pre-fills — the server only
 * hands out the masked form, and editing means retyping the number in full.
 */
export function PayoutMethodForm({ banks, method }: PayoutMethodFormProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(method === null);
  const [saving, setSaving] = useState(false);
  const [bankCode, setBankCode] = useState(method?.bankCode ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState(method?.accountName ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (!editing && method) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-brand-ink">
            {method.bankName}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {method.accountNumberMasked} · {method.accountName}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Change
        </Button>
      </div>
    );
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setFieldErrors({});

    let response: Response;
    try {
      response = await fetch('/api/creator/payout-method', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankCode, accountNumber, accountName }),
      });
    } catch {
      toast.error('Could not reach the server. Try again.');
      setSaving(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const details = body?.error?.details;
      if (details && typeof details === 'object') {
        setFieldErrors(details as Record<string, string[]>);
      } else {
        toast.error(
          body?.error?.message ?? 'Could not save the payout method.'
        );
      }
      setSaving(false);
      return;
    }

    toast.success(PAYOUT_METHOD_SAVED);
    setEditing(false);
    setSaving(false);
    setAccountNumber('');
    router.refresh();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payout-bank">Bank or mobile money</Label>
        <Select
          value={bankCode}
          onValueChange={(value) => setBankCode(value ?? '')}
        >
          <SelectTrigger id="payout-bank">
            <SelectValue placeholder="Choose a destination" />
          </SelectTrigger>
          <SelectContent>
            {banks.map((bank) => (
              <SelectItem key={bank.code} value={bank.code}>
                {bank.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors.bankCode?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.bankCode[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payout-account-number">Account number</Label>
        <Input
          id="payout-account-number"
          inputMode="numeric"
          autoComplete="off"
          value={accountNumber}
          onChange={(event) => setAccountNumber(event.target.value)}
          placeholder={method ? `Currently ${method.accountNumberMasked}` : ''}
        />
        {fieldErrors.accountNumber?.[0] ? (
          <p className="text-xs text-destructive">
            {fieldErrors.accountNumber[0]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payout-account-name">Account holder name</Label>
        <Input
          id="payout-account-name"
          autoComplete="off"
          value={accountName}
          onChange={(event) => setAccountName(event.target.value)}
        />
        {fieldErrors.accountName?.[0] ? (
          <p className="text-xs text-destructive">
            {fieldErrors.accountName[0]}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save payout method'}
        </Button>
        {method ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
