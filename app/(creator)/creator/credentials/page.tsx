import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { needsCredentials, requireRole } from '@/lib/auth';
import { readCredentialsStatus } from '@/lib/creators/credentials';
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

  return (
    <div className="mx-auto w-full max-w-md py-8">
      <PageHeader
        label="One more step"
        title="Where can we reach you?"
        description="TikTok does not share an email. Add one now, and set a password so you can sign back in without it."
        className="mb-6"
      />
      <CreatorCredentialsForm
        needsEmail={status.needsEmail}
        hasPassword={status.hasPassword}
      />
    </div>
  );
}
