import { Suspense } from 'react';
import { SignInForm } from './sign-in-form';

// `useSearchParams` in the form bails out of prerendering, and a production
// build fails outright unless that bail-out is contained by a Suspense
// boundary. Keeping the page a server component confines it to the form.
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="h-[26rem] w-full max-w-md rounded-[24px] border border-neutral-200 bg-neutral-50 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)]" />
      }
    >
      <SignInForm />
    </Suspense>
  );
}
