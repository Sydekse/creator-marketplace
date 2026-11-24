import { redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { needsCredentials, requireRole } from '@/lib/auth';
import {
  readCredentialsStatus,
  sessionTiktokHandle,
} from '@/lib/creators/credentials';
import { CreatorCredentialsForm } from './credentials-form';

export const runtime = 'nodejs';

/**
 * The step Login Kit cannot do: a real email and a password (phase 1).
 *
 * A creator arrives here only while `needsCredentials` still holds. Once both
 * the email and the password exist, onboarding is the next page, so the form
 * never asks again for what it already has.
 *
 * v4 conversion: the credentials step now uses the creator workspace shell and
 * a compact guidance rail around the unchanged form.
 */
export default async function CreatorCredentialsPage() {
  const user = await requireRole('creator');

  const status = await readCredentialsStatus(user);
  if (!needsCredentials(user) && status.hasPassword) {
    redirect('/creator/onboarding');
  }

  const tiktokHandle =
    (await sessionTiktokHandle(user.id)) ?? status.tiktokHandle;

  return (
    <BdShell className="bd-cr bd-cr-auth">
      <BdPageHead
        eyebrow="Creator workspace"
        title="Secure your creator account"
        facts="Add the contact and password details offers and payout notices depend on."
        ruled
      />

      <div
        className="bd-cr-authsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <aside className="bd-caprail bd-cr-authrail">
          <div className="bd-railcell">
            <span className="bd-railk">Step 01</span>
            <span className="bd-railv">Email proof</span>
            <span className="bd-railn">
              Verify a real inbox before marketplace notifications use it.
            </span>
          </div>
          <div className="bd-railcell">
            <span className="bd-railk">Step 02</span>
            <span className="bd-railv">Password</span>
            <span className="bd-railn">
              Keep TikTok login and email/password access in one account.
            </span>
          </div>
          {tiktokHandle ? (
            <p className="bd-railfoot">
              Linked account:{' '}
              <span className="bd-mono">
                @{tiktokHandle.replace(/^@+/, '')}
              </span>
            </p>
          ) : null}
        </aside>

        <section className="bd-briefcard bd-cr-formcard">
          <CreatorCredentialsForm
            needsEmail={status.needsEmail}
            hasPassword={status.hasPassword}
            tiktokHandle={tiktokHandle}
          />
        </section>
      </div>
    </BdShell>
  );
}
