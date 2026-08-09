'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_CAMPAIGN_GOAL_LENGTH,
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_CAMPAIGN_TARGET_AUDIENCE_LENGTH,
  createCampaignSchema,
  fieldErrorsAt,
  updateCampaignSchema,
  zodIssuesToDetails,
} from '@/lib/validation';
import type { FieldErrorMap } from '@/lib/validation';

export interface CampaignBriefFormProps {
  mode: 'create' | 'edit';
  campaign?: {
    id: string;
    name: string;
    goal?: string | null;
    targetAudience?: unknown;
    budget: number; // in santim
    desiredVideos: number;
  };
}

export function CampaignBriefForm({ mode, campaign }: CampaignBriefFormProps) {
  const router = useRouter();

  const [name, setName] = useState(campaign?.name ?? '');
  // Budget is entered in ETB by the brand (1 ETB = 100 santim); fractional
  // values like 1500.50 are valid and round-trip losslessly through santim.
  const [budget, setBudget] = useState(
    campaign ? String(campaign.budget / 100) : ''
  );
  const [desiredVideos, setDesiredVideos] = useState(
    campaign ? String(campaign.desiredVideos) : ''
  );
  const [goal, setGoal] = useState(campaign?.goal ?? '');
  const [audienceDescription, setAudienceDescription] = useState(() => {
    if (
      typeof campaign?.targetAudience === 'object' &&
      campaign?.targetAudience !== null &&
      'description' in campaign.targetAudience
    ) {
      return String(
        (campaign.targetAudience as { description?: unknown }).description ?? ''
      );
    }
    return '';
  });

  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [submitting, setSubmitting] = useState(false);

  const nameErrors = fieldErrorsAt(errors, 'name');
  const budgetErrors = fieldErrorsAt(errors, 'budget');
  const desiredVideosErrors = fieldErrorsAt(errors, 'desiredVideos');
  const goalErrors = fieldErrorsAt(errors, 'goal');
  const targetAudienceErrors = fieldErrorsAt(errors, 'targetAudience');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    const etbNum = budget.trim() === '' ? undefined : Number(budget);
    // Note on float math: `etbNum * 100` is float multiplication on a money
    // value, which is generally unsafe. It is defensible here because it is
    // client-side, immediately rounded, and strictly re-validated by `.int()`
    // on the server-side schema.
    const santim =
      etbNum === undefined || isNaN(etbNum) ? etbNum : Math.round(etbNum * 100);
    const videosNum =
      desiredVideos.trim() === '' ? undefined : Number(desiredVideos);

    const payload: Record<string, unknown> = {
      name,
      budget: santim,
      desiredVideos: videosNum,
    };

    if (goal.trim()) {
      payload.goal = goal.trim();
    }

    if (audienceDescription.trim()) {
      payload.targetAudience = { description: audienceDescription.trim() };
    }

    const schema =
      mode === 'create' ? createCampaignSchema : updateCampaignSchema;
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      setErrors(zodIssuesToDetails(parsed.error));
      return;
    }

    setSubmitting(true);

    const url =
      mode === 'create' ? '/api/campaigns' : `/api/campaigns/${campaign?.id}`;
    const method = mode === 'create' ? 'POST' : 'PATCH';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      toast.success(
        mode === 'create' ? 'Campaign draft created.' : 'Campaign updated.'
      );
      router.refresh();
      router.push('/campaigns');
      return;
    }

    const body = await response.json().catch(() => null);
    const error = body?.error;

    if (error?.details) {
      setErrors(error.details as FieldErrorMap);
    }
    if (error?.message && !error?.details) {
      toast.error(error.message);
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup className="gap-6">
        <Field data-invalid={nameErrors !== undefined || undefined}>
          <FieldLabel htmlFor="name">Campaign name</FieldLabel>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 text-base"
            placeholder="e.g. New Year Product Showcase"
            maxLength={MAX_CAMPAIGN_NAME_LENGTH}
            autoFocus={mode === 'create'}
            aria-invalid={nameErrors !== undefined || undefined}
          />
          <FieldDescription>
            A descriptive title for your campaign. Up to{' '}
            {MAX_CAMPAIGN_NAME_LENGTH} characters.
          </FieldDescription>
          <FieldError errors={nameErrors} />
        </Field>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field data-invalid={budgetErrors !== undefined || undefined}>
            <FieldLabel htmlFor="budget">Total budget (ETB)</FieldLabel>
            <Input
              id="budget"
              name="budget"
              type="number"
              min="0.01"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="h-11 text-base"
              placeholder="e.g. 50000"
              aria-invalid={budgetErrors !== undefined || undefined}
            />
            <FieldDescription>
              Total budget in Ethiopian Birr (e.g. 1500.50). Minimum 0.01 ETB.
            </FieldDescription>
            <FieldError errors={budgetErrors} />
          </Field>

          <Field data-invalid={desiredVideosErrors !== undefined || undefined}>
            <FieldLabel htmlFor="desiredVideos">Target video count</FieldLabel>
            <Input
              id="desiredVideos"
              name="desiredVideos"
              type="number"
              min="1"
              step="1"
              value={desiredVideos}
              onChange={(e) => setDesiredVideos(e.target.value)}
              className="h-11 text-base"
              placeholder="e.g. 5"
              aria-invalid={desiredVideosErrors !== undefined || undefined}
            />
            <FieldDescription>
              Total number of creator videos you want delivered.
            </FieldDescription>
            <FieldError errors={desiredVideosErrors} />
          </Field>
        </div>

        <Field data-invalid={goalErrors !== undefined || undefined}>
          <FieldLabel htmlFor="goal">Campaign goal (optional)</FieldLabel>
          <Textarea
            id="goal"
            name="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="min-h-24 text-base"
            placeholder="What are the key objectives and message of this campaign?"
            maxLength={MAX_CAMPAIGN_GOAL_LENGTH}
            aria-invalid={goalErrors !== undefined || undefined}
          />
          <FieldDescription>
            Provide creators with context on your campaign goals and key
            messaging.
          </FieldDescription>
          <FieldError errors={goalErrors} />
        </Field>

        <Field data-invalid={targetAudienceErrors !== undefined || undefined}>
          <FieldLabel htmlFor="targetAudience">
            Target audience (optional)
          </FieldLabel>
          <Textarea
            id="targetAudience"
            name="targetAudience"
            value={audienceDescription}
            onChange={(e) => setAudienceDescription(e.target.value)}
            className="min-h-24 text-base"
            placeholder="Describe your ideal audience demographics, interests, or location."
            maxLength={MAX_CAMPAIGN_TARGET_AUDIENCE_LENGTH}
            aria-invalid={targetAudienceErrors !== undefined || undefined}
          />
          <FieldDescription>
            Helps pick matching creators during discovery and deal building.
          </FieldDescription>
          <FieldError errors={targetAudienceErrors} />
        </Field>

        {fieldErrorsAt(errors, '_root') && (
          <FieldError errors={fieldErrorsAt(errors, '_root')} />
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
          <Button type="submit" disabled={submitting} size="lg">
            {submitting && <Spinner />}
            {submitting
              ? 'Saving…'
              : mode === 'create'
                ? 'Create draft campaign'
                : 'Save changes'}
          </Button>
          <Link
            href="/campaigns"
            className={buttonVariants({ variant: 'ghost', size: 'lg' })}
          >
            Cancel
          </Link>
        </div>
      </FieldGroup>
    </form>
  );
}
