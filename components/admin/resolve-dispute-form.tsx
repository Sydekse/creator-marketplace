'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

/** The 200 body of `POST /api/admin/deals/{id}/resolve`. */
interface ResolveResponse {
  deal_id: string;
  status: string;
  resolution: 'release' | 'refund' | 'revision';
}

/**
 * Admin dispute-resolution form (KAN-51 AC-030, KAN-60 flow 6).
 *
 * One form per worklist row; POSTs the existing `/api/admin/deals/{id}/resolve`
 * endpoint, which owns validation, the 403 gate, and the ledger work. On
 * success the row's flag is cleared and its status moves out of the worklist,
 * so a `router.refresh()` makes it disappear — the resolution is the row
 * leaving, and leaving is the confirmation the admin needs.
 *
 * The note is required by the route (`resolveDisputeSchema` rejects an empty
 * or whitespace-only note), so the form does not offer a "skip note" path —
 * an action that writes an audit row should never be anonymous.
 */

interface ResolveDisputeFormProps {
  dealId: string;
  status: string;
  campaignName: string;
}

const RESOLUTION_OPTIONS = [
  { value: 'refund', label: 'Refund the brand' },
  { value: 'release', label: 'Release funds to the creator' },
  { value: 'revision', label: 'Request a revision' },
] as const;

export function ResolveDisputeForm({
  dealId,
  status,
  campaignName,
}: ResolveDisputeFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] =
    useState<(typeof RESOLUTION_OPTIONS)[number]['value']>('refund');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleResolve() {
    if (submitting) return;

    const trimmedNote = note.trim();
    if (!trimmedNote) {
      toast.error('A resolution note is required.');
      return;
    }

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/admin/deals/${encodeURIComponent(dealId)}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolution, note: trimmedNote }),
        }
      );
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      const result = (await response.json()) as ResolveResponse;
      const label =
        RESOLUTION_OPTIONS.find((o) => o.value === result.resolution)?.label ??
        result.resolution;
      toast.success(
        `${campaignName} resolved (${label}) — deal is now ${result.status}.`
      );
      setOpen(false);
      setNote('');
      router.refresh();
    } else {
      let message = 'Resolution failed. Please try again.';
      try {
        const body = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON failure body — keep the generic message.
      }
      toast.error(message);
    }
    setSubmitting(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Resolve dispute
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`resolution-${dealId}`}>Resolution</Label>
        <select
          id={`resolution-${dealId}`}
          value={resolution}
          onChange={(event) =>
            setResolution(event.target.value as typeof resolution)
          }
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {RESOLUTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`note-${dealId}`}>Resolution note</Label>
        <Textarea
          id={`note-${dealId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this resolution — this note is written to the audit log."
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          Deal status: {status}. The note is recorded with the resolution.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={submitting}
          onClick={handleResolve}
        >
          {submitting ? <Spinner /> : null}
          Confirm resolution
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
