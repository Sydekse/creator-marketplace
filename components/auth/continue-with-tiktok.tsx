'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TikTokIcon } from '@/components/brand/tiktok-icon';
import { authClient } from '@/lib/auth-client';
import {
  TIKTOK_OAUTH_ERROR_MESSAGE,
  tiktokOAuthErrorMessage,
} from '@/lib/tiktok-oauth-error';

export function ContinueWithTiktok({
  note = 'Used to verify your account automatically.',
  errorCallbackURL,
  oauthError = null,
}: {
  /**
   * The reassurance line under the button. Pass `null` to render nothing —
   * sign-in omits it: a returning user does not need data-policy copy under
   * a login button.
   */
  note?: string | null;
  /**
   * Where Better Auth sends cancel/deny/provider failures. Omit this and
   * they land on `/api/auth/error` HTML instead of this card.
   */
  errorCallbackURL: '/sign-in' | '/sign-up';
  /** Mapped sentence from `?error=` on the current page, if any. */
  oauthError?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(oauthError);
  const errorId = useId();
  const noteId = useId();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (
      !url.searchParams.has('error') &&
      !url.searchParams.has('error_description')
    ) {
      return;
    }
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }, []);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);

    const { error } = await authClient.signIn.social({
      provider: 'tiktok',
      callbackURL: '/dashboard',
      newUserCallbackURL: '/creator/credentials',
      errorCallbackURL,
    });
    if (error) {
      setErrorMessage(
        tiktokOAuthErrorMessage(error.message) ?? TIKTOK_OAUTH_ERROR_MESSAGE
      );
      setLoading(false);
    }
  }

  const describedBy = [errorMessage ? errorId : null, note ? noteId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled={loading}
        aria-disabled={loading}
        aria-describedby={describedBy || undefined}
        onClick={handleClick}
      >
        <TikTokIcon className="h-4 w-4" />
        {loading ? 'Continuing…' : 'Continue with TikTok'}
      </Button>
      {errorMessage ? (
        <p
          id={errorId}
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] leading-snug text-destructive"
        >
          {errorMessage}
        </p>
      ) : null}
      {note ? (
        <p
          id={noteId}
          className="text-center text-[13px] leading-snug text-neutral-600"
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
