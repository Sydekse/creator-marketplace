'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RevisionCategoryField } from '@/components/deals/revision-category-field';
import type {
  ExpectedVersion,
  RevisionCategory,
} from '@/lib/deliverables/evidence';
import { resolveDisputeSchema } from '@/lib/validation/schemas';

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

type ResolutionVideo = ExpectedVersion & {
  videoOrdinal: number;
  tiktokUrl: string;
};

interface ResolveDisputeFormProps {
  dealId: string;
  status: string;
  campaignName: string;
  displayedVideos?: ResolutionVideo[];
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
  displayedVideos,
}: ResolveDisputeFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] =
    useState<(typeof RESOLUTION_OPTIONS)[number]['value']>('refund');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [videos, setVideos] = useState<ResolutionVideo[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [category, setCategory] = useState<RevisionCategory | null>(null);
  const [loading, setLoading] = useState(false);

  async function openForm() {
    if (displayedVideos) {
      setVideos(displayedVideos);
      setOpen(true);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/deals/${encodeURIComponent(dealId)}/videos`
      );
      if (!response.ok)
        throw new Error('Could not load current videos. Reload the page.');
      const evidence = (await response.json()) as {
        videos: ResolutionVideo[];
      };
      setVideos(evidence.videos);
      setOpen(true);
    } catch {
      toast.error('Could not load current videos. Reload the page.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve() {
    if (submitting) return;

    const trimmedNote = note.trim();
    if (!trimmedNote) {
      toast.error('A resolution note is required.');
      return;
    }
    const target = videos.find((video) => video.id === targetId);
    const parsed = resolveDisputeSchema.safeParse({
      resolution,
      note: trimmedNote,
      ...(resolution === 'revision'
        ? {
            deliverableId: target?.id,
            expectedVersion: target?.submissionVersion,
            category: category ?? undefined,
          }
        : {}),
      ...(resolution === 'release'
        ? {
            expectedVersions: videos.map(({ id, submissionVersion }) => ({
              id,
              submissionVersion,
            })),
          }
        : {}),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
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
          body: JSON.stringify(parsed.data),
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
      if (response.status === 409) {
        setOpen(false);
        router.refresh();
      }
    }
    setSubmitting(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openForm}
        disabled={loading}
      >
        Resolve dispute
      </Button>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 shadow-[0_16px_32px_-28px_rgba(23,23,23,0.4)]">
      {videos.length > 0 && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Videos in this resolution</p>
          <p className="text-xs text-muted-foreground">
            Review these versions before releasing funds or requesting changes.
          </p>
          {videos.map((video) => (
            <a
              key={video.id}
              href={video.tiktokUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Video {video.videoOrdinal} · Version {video.submissionVersion}
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`resolution-${dealId}`}>Resolution</Label>
        <select
          id={`resolution-${dealId}`}
          value={resolution}
          onChange={(event) =>
            setResolution(event.target.value as typeof resolution)
          }
          className="h-10 rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          {RESOLUTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {resolution === 'revision' && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`revision-video-${dealId}`}>
              Video to revise
            </FieldLabel>
            <Select
              value={targetId}
              onValueChange={setTargetId}
              items={videos.map((video) => ({
                value: video.id,
                label: `Video ${video.videoOrdinal} · Version ${video.submissionVersion}`,
              }))}
            >
              <SelectTrigger id={`revision-video-${dealId}`}>
                <SelectValue placeholder="Select a video" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {videos.map((video) => (
                    <SelectItem key={video.id} value={video.id}>
                      Video {video.videoOrdinal} · Version{' '}
                      {video.submissionVersion}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <RevisionCategoryField
            id={`revision-category-${dealId}`}
            value={category}
            onChange={setCategory}
            disabled={submitting}
          />
        </FieldGroup>
      )}
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
