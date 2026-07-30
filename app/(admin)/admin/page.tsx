import { requireRole } from '@/lib/auth';

export default async function AdminConsolePage() {
  const user = await requireRole('admin');

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Admin console</h1>
      <p className="text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}. The verification queue, dispute
        resolution, and audit log land here in later tickets.
      </p>
    </div>
  );
}
