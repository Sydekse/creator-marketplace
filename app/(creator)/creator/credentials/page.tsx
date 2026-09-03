import { redirect } from 'next/navigation';
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
    <div className="flex justify-center py-8">
      <CreatorCredentialsForm
        needsEmail={status.needsEmail}
        hasPassword={status.hasPassword}
        tiktokHandle={tiktokHandle}
      />
    </div>
  );
}
