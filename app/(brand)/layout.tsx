import { Suspense } from 'react';
import { Header } from '@/components/layout/header';
import { WorkspacePageSkeleton } from '@/components/layout/workspace-loading';
import { Toaster } from '@/components/ui/sonner';
import { requireRole } from '@/lib/auth';

export default async function BrandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Role gate, not just an auth check — every route in this group is brand-only.
  // Awaited here so auth stays on screen until the real nav island can paint.
  const user = await requireRole('brand');

  return (
    <>
      <Header user={user} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Suspense fallback={<WorkspacePageSkeleton />}>{children}</Suspense>
      </main>
      <Toaster />
    </>
  );
}
