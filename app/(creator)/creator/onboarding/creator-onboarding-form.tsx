'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AGE_RANGES,
  AUDIENCE_MARKET_CODES,
  AUDIENCE_MARKET_LABELS,
  ENGAGEMENT_RATE_HINT,
  NICHES,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { AgeRange, Niche } from '@/lib/config/creator-profile';
import { normalizeTiktokHandle } from '@/lib/creators/handle';
import type { TiktokStats } from '@/lib/tiktok/stats';
import {
  createCreatorSchema,
  fieldErrorsAt,
  zodIssuesToDetails,
} from '@/lib/validation';
import type { FieldErrorMap } from '@/lib/validation';

/**
 * Creator onboarding form (US-001, AC-001, AC-003).
 *
 * Client-side validation here is a convenience, never the gate — the same
 * `createCreatorSchema` runs again in the route handler, which is the only
 * enforcement point (NFR-005). This form can be bypassed entirely with curl and
 * nothing about that is a problem.
 *
 * Error display is driven by the server's `details` map rather than by local
 * assumptions, so a server rule this form does not know about still lands on
 * the right input.
 */

export function CreatorOnboardingForm({
  lockedHandle = null,
  lockedStats = null,
}: {
  /**
   * The handle Login Kit captured at sign-up, or null for email sign-ups.
   * When present the field is prefilled and read-only: the server writes this
   * value regardless of the request body (see POST /api/creators), so an
   * editable field would let the creator type a handle that is silently
   * ignored.
   */
  lockedHandle?: string | null;
  /**
   * Live numbers from the TikTok API (phase 2), or null when unavailable.
   * Same contract as the handle: the server re-fetches and overrides the body,
   * so any field with an API value renders read-only. Each field falls back to
   * editable independently — stats without videos still locks the follower
   * count while leaving engagement typed.
   */
  lockedStats?: TiktokStats | null;
} = {}) {
  const router = useRouter();

  const lockedFollowers = lockedStats?.followerCount ?? null;
  const lockedEngagement = lockedStats?.engagementRate ?? null;

  const [handleInput, setHandleInput] = useState(() =>
    lockedHandle ? lockedHandle.replace(/^@+/, '') : ''
  );
  const [niche, setNiche] = useState<Niche | null>(null);
  const [markets, setMarkets] = useState<string[]>([]);
  const [ageRange, setAgeRange] = useState<AgeRange | null>(null);
  const [followerCount, setFollowerCount] = useState(() =>
    lockedFollowers !== null ? String(lockedFollowers) : ''
  );
  const [engagementRate, setEngagementRate] = useState(
    () => lockedEngagement ?? ''
  );
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [submitting, setSubmitting] = useState(false);

  // The canonical form the server will store, computed with the exact function
  // the schema uses. Showing it as the creator types is what makes the
  // normalisation rule visible instead of a surprise on the confirmation page.
  const normalized = normalizeTiktokHandle(handleInput);
  const handleChanged = normalized !== '' && normalized !== `@${handleInput}`;

  // Prefix-matched, not looked up — see `lib/validation/field-errors.ts` for
  // why an exact lookup renders nothing for a bad audience market.
  function fieldError(name: string) {
    return fieldErrorsAt(errors, name);
  }

  function hasError(name: string) {
    return fieldError(name) !== undefined;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    // Empty optional numbers are absent, not zero — a creator who leaves
    // follower count blank has not told us they have no followers.
    const payload = {
      tiktokHandle: handleInput,
      niche,
      audience: {
        topCountries: markets,
        ageRange,
      },
      followerCount: followerCount === '' ? undefined : Number(followerCount),
      engagementRate:
        engagementRate === '' ? undefined : Number(engagementRate),
    };

    const parsed = createCreatorSchema.safeParse(payload);
    if (!parsed.success) {
      // The same flattener the server uses, so client-side and server-side
      // issues arrive under identical keys and render through one path.
      setErrors(zodIssuesToDetails(parsed.error));
      return;
    }

    setSubmitting(true);

    let response: Response;
    try {
      response = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
    } catch {
      toast.error('Could not reach the server. Check your connection.');
      setSubmitting(false);
      return;
    }

    if (response.ok) {
      // `refresh()` before `push()` so the creator page re-runs its profile
      // read on the server; without it the router cache can serve the version
      // that redirected here in the first place.
      router.refresh();
      router.push('/creator');
      return;
    }

    const body = await response.json().catch(() => null);
    const error = body?.error;

    // `details` from the server wins, so AC-003's exact string lands under the
    // handle input rather than in a toast the creator has to translate.
    if (error?.details) {
      setErrors(error.details as FieldErrorMap);
    }
    if (error?.message && !error?.details) {
      toast.error(error.message);
    }
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-6 shadow-[0_24px_60px_-32px_rgba(23,23,23,0.25)] sm:p-9"
    >
      <FieldGroup className="gap-0">
        <section className="border-b border-neutral-200 pb-9">
          <div className="mb-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
              Creator profile
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              Start with the account and category brands will use to find you.
            </p>
          </div>
          <div className="grid gap-7 sm:grid-cols-2">
            <Field data-invalid={hasError('tiktokHandle') || undefined}>
              <FieldLabel
                htmlFor="tiktokHandle"
                className="text-[13px] font-semibold text-neutral-700"
              >
                TikTok handle
              </FieldLabel>
              <InputGroup className="h-12 bg-neutral-50 focus-within:bg-white">
                {/* The @ is furniture, not input — typing one is handled by the
                normaliser, so both habits produce the same stored value. */}
                <InputGroupAddon className="font-mono text-base">
                  @
                </InputGroupAddon>
                <Input
                  id="tiktokHandle"
                  name="tiktokHandle"
                  value={handleInput}
                  onChange={(event) => setHandleInput(event.target.value)}
                  readOnly={lockedHandle !== null}
                  data-slot="input-group-control"
                  className={`border-0 font-mono text-base shadow-none focus-visible:ring-0 ${
                    lockedHandle !== null ? 'text-neutral-500' : ''
                  }`}
                  placeholder="yourhandle"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={hasError('tiktokHandle') || undefined}
                  aria-describedby="tiktokHandle-preview"
                />
              </InputGroup>
              <FieldDescription
                id="tiktokHandle-preview"
                className="text-[13px] leading-relaxed text-neutral-500"
              >
                {lockedHandle !== null ? (
                  'Linked from your TikTok login. This is the account brands will review.'
                ) : normalized === '' ? (
                  'Use the account brands should review. 2–24 letters, numbers, underscores or periods.'
                ) : (
                  <>
                    Saved as{' '}
                    <span className="font-mono text-foreground">
                      {normalized}
                    </span>
                    {handleChanged && '. Handles are stored in lower case.'}
                  </>
                )}
              </FieldDescription>
              <FieldError errors={fieldError('tiktokHandle')} />
            </Field>

            <Field data-invalid={hasError('niche') || undefined}>
              <FieldLabel
                htmlFor="niche"
                className="text-[13px] font-semibold text-neutral-700"
              >
                Main niche
              </FieldLabel>
              <Select
                items={NICHES.map((value) => ({
                  value,
                  label: NICHE_LABELS[value],
                }))}
                value={niche}
                onValueChange={(value) => setNiche(value as Niche)}
              >
                <SelectTrigger
                  id="niche"
                  className={`h-12 w-full ${
                    niche
                      ? 'border-brand/40 bg-brand-tint font-medium text-brand-ink'
                      : 'bg-neutral-50'
                  }`}
                >
                  <SelectValue placeholder="Choose the niche you post in" />
                </SelectTrigger>
                <SelectContent>
                  {NICHES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {NICHE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription className="text-[13px] leading-relaxed text-neutral-500">
                Choose the category that best describes most of your posts.
              </FieldDescription>
              <FieldError errors={fieldError('niche')} />
            </Field>
          </div>
        </section>

        <section className="border-b border-neutral-200 py-9">
          <div className="mb-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
              Audience
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              Select the people who make up most of your current audience.
            </p>
          </div>
          <div className="space-y-7">
            <Field
              data-invalid={hasError('audience.topCountries') || undefined}
            >
              <FieldLabel
                htmlFor="markets"
                className="text-[13px] font-semibold text-neutral-700"
              >
                Top audience markets
              </FieldLabel>
              <ToggleGroup
                id="markets"
                multiple
                variant="outline"
                value={markets}
                onValueChange={setMarkets}
                className="flex-wrap gap-2"
              >
                {AUDIENCE_MARKET_CODES.map((code) => (
                  <ToggleGroupItem
                    key={code}
                    value={code}
                    className="h-10 px-4 aria-pressed:border-brand/40 aria-pressed:bg-brand-tint aria-pressed:text-brand-ink data-[state=on]:border-brand/40 data-[state=on]:bg-brand-tint data-[state=on]:text-brand-ink"
                  >
                    {AUDIENCE_MARKET_LABELS[code]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription className="text-[13px] leading-relaxed text-neutral-500">
                Choose every market that applies.
              </FieldDescription>
              <FieldError errors={fieldError('audience.topCountries')} />
            </Field>

            <Field data-invalid={hasError('audience.ageRange') || undefined}>
              <FieldLabel
                htmlFor="ageRange"
                className="text-[13px] font-semibold text-neutral-700"
              >
                Main audience age
              </FieldLabel>
              <ToggleGroup
                id="ageRange"
                variant="outline"
                value={ageRange ? [ageRange] : []}
                onValueChange={(value) =>
                  setAgeRange((value[0] as AgeRange) ?? null)
                }
                className="flex-wrap gap-2"
              >
                {AGE_RANGES.map((range) => (
                  <ToggleGroupItem
                    key={range}
                    value={range}
                    className="h-10 px-4 font-mono aria-pressed:border-brand/40 aria-pressed:bg-brand-tint aria-pressed:text-brand-ink data-[state=on]:border-brand/40 data-[state=on]:bg-brand-tint data-[state=on]:text-brand-ink"
                  >
                    {range}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldError errors={fieldError('audience.ageRange')} />
            </Field>
          </div>
        </section>

        {/* Optional, and labelled as such: a creator who cannot find these
            numbers must still be able to finish onboarding. API-sourced values
            render read-only — the server re-fetches and overrides the body, so
            an editable field would be a lie. */}
        <section className="py-9">
          <div className="mb-6">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
              Performance
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              {lockedFollowers !== null || lockedEngagement !== null
                ? 'Pulled from your TikTok account. These set your tier and rate.'
                : 'Optional. Add these if you know them; you can still submit without them.'}
            </p>
          </div>
          <div className="grid gap-7 sm:grid-cols-2">
            <Field data-invalid={hasError('followerCount') || undefined}>
              <FieldLabel
                htmlFor="followerCount"
                className="text-[13px] font-semibold text-neutral-700"
              >
                Followers{' '}
                <span className="font-normal text-muted-foreground">
                  {lockedFollowers !== null ? '(from TikTok)' : '(optional)'}
                </span>
              </FieldLabel>
              <Input
                id="followerCount"
                name="followerCount"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={followerCount}
                onChange={(event) => setFollowerCount(event.target.value)}
                readOnly={lockedFollowers !== null}
                className={`h-12 bg-neutral-50 px-3.5 font-mono focus-visible:bg-white ${
                  lockedFollowers !== null ? 'text-neutral-500' : ''
                }`}
                placeholder="12000"
                aria-invalid={hasError('followerCount') || undefined}
              />
              <FieldError errors={fieldError('followerCount')} />
            </Field>

            <Field data-invalid={hasError('engagementRate') || undefined}>
              <FieldLabel
                htmlFor="engagementRate"
                className="text-[13px] font-semibold text-neutral-700"
              >
                Engagement rate{' '}
                <span className="font-normal text-muted-foreground">
                  {lockedEngagement !== null ? '(from TikTok)' : '(optional)'}
                </span>
              </FieldLabel>
              <InputGroup className="h-12 bg-neutral-50 focus-within:bg-white">
                <Input
                  id="engagementRate"
                  name="engagementRate"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.01}
                  value={engagementRate}
                  onChange={(event) => setEngagementRate(event.target.value)}
                  readOnly={lockedEngagement !== null}
                  data-slot="input-group-control"
                  className={`border-0 font-mono shadow-none focus-visible:ring-0 ${
                    lockedEngagement !== null ? 'text-neutral-500' : ''
                  }`}
                  placeholder="4.20"
                  aria-invalid={hasError('engagementRate') || undefined}
                />
                <InputGroupAddon align="inline-end">%</InputGroupAddon>
              </InputGroup>
              <FieldDescription className="text-[13px] leading-relaxed text-neutral-500">
                {lockedEngagement !== null
                  ? 'Computed from your recent videos: likes, comments and shares per view.'
                  : ENGAGEMENT_RATE_HINT}
              </FieldDescription>
              <FieldError errors={fieldError('engagementRate')} />
            </Field>
          </div>
        </section>

        {hasError('_root') && (
          <FieldError errors={fieldError('_root')} className="text-sm" />
        )}

        <div className="flex flex-col gap-4 border-t border-neutral-200 pt-8 sm:flex-row sm:items-end sm:justify-between">
          <Button
            type="submit"
            disabled={submitting}
            size="lg"
            className="w-full sm:w-auto sm:self-start"
          >
            {submitting && <Spinner />}
            {submitting ? 'Submitting…' : 'Create profile'}
          </Button>
          <p className="text-[13px] leading-relaxed text-neutral-500">
            Your profile goes live as soon as it is created. Brands can find
            you in search once your numbers place you on a pricing tier.
          </p>
        </div>
      </FieldGroup>
    </form>
  );
}
