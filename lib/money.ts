/**
 * Money formatting for display.
 *
 * Amounts are integers in ETB santim everywhere in the system (invariant 4;
 * tech spec §3). This module is the only place a santim value becomes a string
 * for a human, which is what keeps AC-005's "no floating-point formatting
 * drift" a property of the code rather than a convention people remember.
 *
 * Promoted here from `lib/notifications/templates.tsx` on KAN-24, which is what
 * that function's own docstring nominated. The forcing reason is bundling, not
 * tidiness: `templates.tsx` imports `@react-email/components`, so importing the
 * formatter from a page would pull the email renderer into the app bundle.
 * `templates.tsx` re-exports it, so `lib/notifications/index.ts` and the KAN-54
 * tests that import from `../lib/notifications` need no change.
 */

/**
 * Integer ETB santim → a human amount.
 *
 * Integer division and modulo throughout, so no float ever touches a money
 * value even on the display path. `1_500_00` santim renders `1,500.00 ETB`.
 *
 * The negative sign is U+2212 MINUS SIGN, not a hyphen — these render beside
 * amounts in ledger and payout contexts, where a hyphen reads as a dash.
 */
export function formatEtb(santim: number): string {
  const negative = santim < 0;
  const abs = Math.abs(santim);
  const birr = Math.trunc(abs / 100);
  const cents = abs % 100;
  const formatted = `${birr.toLocaleString('en-US')}.${String(cents).padStart(2, '0')} ETB`;
  return negative ? `−${formatted}` : formatted;
}
