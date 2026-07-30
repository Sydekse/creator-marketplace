import { requireRole } from '@/lib/auth';

export default async function CreatorDashboardPage() {
  const user = await requireRole('creator');

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        Creator dashboard
      </h1>
      <p className="text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}. Deal offers and deliverables
        land here in a later ticket.
      </p>
    </div>
  );
}
