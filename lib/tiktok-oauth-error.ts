/**
 * Better Auth's OAuth callback appends `?error=<code>` (and sometimes
 * `error_description`). The description is provider prose and must never
 * reach the card. Every code — cancel, missing keys, TikTok down — is the
 * same sentence so the creator has one next step: try again.
 */
export const TIKTOK_OAUTH_ERROR_MESSAGE =
  "Couldn't connect to TikTok. Try again.";

export function tiktokOAuthErrorMessage(
  error: string | null | undefined
): string | null {
  if (error == null) return null;
  const code = error.trim();
  if (code === '') return null;
  return TIKTOK_OAUTH_ERROR_MESSAGE;
}
