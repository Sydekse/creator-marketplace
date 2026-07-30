import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { SignInForm } from './sign-in-form';

// `useSearchParams` in the form bails out of prerendering, and a production
// build fails outright unless that bail-out is contained by a Suspense
// boundary. Keeping the page a server component confines it to the form.
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={<Card className="h-[26rem] w-full max-w-sm p-8" />}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
