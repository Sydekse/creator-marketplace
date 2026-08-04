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
  NICHES,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { AgeRange, Niche } from '@/lib/config/creator-profile';
import { normalizeTiktokHandle } from '@/lib/creators/handle';
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

export function CreatorOnboardingForm() {
  const router = useRouter();

  const [handleInput, setHandleInput] = useState('');
  const [niche, setNiche] = useState<Niche | null>(null);
  const [markets, setMarkets] = useState<string[]>([]);
  const [ageRange, setAgeRange] = useState<AgeRange | null>(null);
  const [followerCount, setFollowerCount] = useState('');
  const [engagementRate, setEngagementRate] = useState('');
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
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup className="gap-8">
        <Field data-invalid={hasError('tiktokHandle') || undefined}>
          <FieldLabel htmlFor="tiktokHandle">TikTok handle</FieldLabel>
          <InputGroup className="h-11">
            {/* The @ is furniture, not input — typing one is handled by the
                normaliser, so both habits produce the same stored value. */}
            <InputGroupAddon className="font-mono text-base">@</InputGroupAddon>
            <Input
              id="tiktokHandle"
              name="tiktokHandle"
              value={handleInput}
              onChange={(event) => setHandleInput(event.target.value)}
              data-slot="input-group-control"
              className="border-0 font-mono text-base shadow-none focus-visible:ring-0"
              placeholder="yourhandle"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={hasError('tiktokHandle') || undefined}
              aria-describedby="tiktokHandle-preview"
            />
          </InputGroup>
          <FieldDescription id="tiktokHandle-preview">
            {normalized === '' ? (
              'The account brands will see. 2–24 letters, numbers, underscores or periods.'
            ) : (
              <>
                Saved as{' '}
                <span className="font-mono text-foreground">{normalized}</span>
                {handleChanged && ' — handles are stored in lower case.'}
              </>
            )}
          </FieldDescription>
          <FieldError errors={fieldError('tiktokHandle')} />
        </Field>

        <Field data-invalid={hasError('niche') || undefined}>
          <FieldLabel htmlFor="niche">Niche</FieldLabel>
          <Select
            items={NICHES.map((value) => ({
              value,
              label: NICHE_LABELS[value],
            }))}
            value={niche}
            onValueChange={(value) => setNiche(value as Niche)}
          >
            <SelectTrigger id="niche" className="h-11 w-full">
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
          <FieldDescription>
            Brands filter by niche, so pick where most of your posts sit.
          </FieldDescription>
          <FieldError errors={fieldError('niche')} />
        </Field>

        <Field data-invalid={hasError('audience.topCountries') || undefined}>
          <FieldLabel htmlFor="markets">Top audience markets</FieldLabel>
          <ToggleGroup
            id="markets"
            multiple
            variant="outline"
            value={markets}
            onValueChange={setMarkets}
            className="flex-wrap"
          >
            {AUDIENCE_MARKET_CODES.map((code) => (
              <ToggleGroupItem key={code} value={code} className="h-9 px-3">
                {AUDIENCE_MARKET_LABELS[code]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>Choose every market that applies.</FieldDescription>
          <FieldError errors={fieldError('audience.topCountries')} />
        </Field>

        <Field data-invalid={hasError('audience.ageRange') || undefined}>
          <FieldLabel htmlFor="ageRange">Main audience age</FieldLabel>
          <ToggleGroup
            id="ageRange"
            variant="outline"
            value={ageRange ? [ageRange] : []}
            onValueChange={(value) =>
              setAgeRange((value[0] as AgeRange) ?? null)
            }
            className="flex-wrap"
          >
            {AGE_RANGES.map((range) => (
              <ToggleGroupItem
                key={range}
                value={range}
                className="h-9 px-3 font-mono"
              >
                {range}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldError errors={fieldError('audience.ageRange')} />
        </Field>

        {/* Optional, and labelled as such: a creator who cannot find these
            numbers must still be able to finish onboarding. */}
        <div className="grid gap-8 sm:grid-cols-2">
          <Field data-invalid={hasError('followerCount') || undefined}>
            <FieldLabel htmlFor="followerCount">
              Followers{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
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
              className="h-11 font-mono"
              placeholder="12000"
              aria-invalid={hasError('followerCount') || undefined}
            />
            <FieldError errors={fieldError('followerCount')} />
          </Field>

          <Field data-invalid={hasError('engagementRate') || undefined}>
            <FieldLabel htmlFor="engagementRate">
              Engagement rate{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <InputGroup className="h-11">
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
                data-slot="input-group-control"
                className="border-0 font-mono shadow-none focus-visible:ring-0"
                placeholder="4.20"
                aria-invalid={hasError('engagementRate') || undefined}
              />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
            <FieldError errors={fieldError('engagementRate')} />
          </Field>
        </div>

        {hasError('_root') && (
          <FieldError errors={fieldError('_root')} className="text-sm" />
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-8">
          <Button
            type="submit"
            disabled={submitting}
            size="lg"
            className="w-full sm:w-auto sm:self-start"
          >
            {submitting && <Spinner />}
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </Button>
          <p className="text-sm text-muted-foreground">
            A person reviews your handle before brands can find you. You will
            not be visible in search until then.
          </p>
        </div>
      </FieldGroup>
    </form>
  );
}
