import { Header } from '@/components/layout/header';
import { Toaster } from '@/components/ui/sonner';
import { requireUser } from '@/lib/auth';

/**
 * Notifications layout (KAN-96).
 *
 * Role-agnostic: any signed-in user (creator, brand, or admin) can read their
 * notifications. `requireUser` gates on session only — no role redirect. The
 * header renders the same way it does on every other page.
 */
export default async function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <>
      <Header user={user} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Toaster />
    </>
  );
}
