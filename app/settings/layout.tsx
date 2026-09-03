import { Header } from '@/components/layout/header';
import { Toaster } from '@/components/ui/sonner';
import { requireUser } from '@/lib/auth';

/**
 * Settings layout. Role-agnostic like /notifications: any signed-in user
 * (creator, brand, or admin) manages their own account here. `requireUser`
 * gates on session only — the page itself branches on role for the
 * workspace chapter.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <>
      <Header user={user} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Toaster />
    </>
  );
}
