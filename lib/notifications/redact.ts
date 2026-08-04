/**
 * Log redaction for NFR-010 — "shall not expose sensitive data in logs".
 *
 * The notification path is the one place in the app that routinely *holds* an
 * email address at the moment it also wants to log something, so this is where
 * the rule needs a concrete implementation rather than good intentions.
 */

/**
 * `natnael@example.com` → `n***l@example.com`.
 *
 * The domain survives because it is what makes a log useful — "every send to
 * this domain is bouncing" is the diagnosis you actually need — while the local
 * part is what identifies a person. First and last character are kept so two
 * different addresses at one domain stay distinguishable in a log trace.
 *
 * Anything that is not shaped like an address is redacted whole: a value in
 * this position that we cannot parse is more likely to be unexpected user data
 * than something safe to print.
 */
export function redactEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '[redacted]';

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (local.length <= 2) return `${'*'.repeat(local.length)}@${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}
