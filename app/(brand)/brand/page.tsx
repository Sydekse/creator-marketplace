import { requireRole } from '@/lib/auth';

export default async function BrandDashboardPage() {
  const user = await requireRole('brand');

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Brand dashboard</h1>
      <p className="text-sm text-muted-foreground">
        Signed in as {user.name ?? user.email}. Campaigns and creator discovery
        land here in a later ticket.
      </p>
    </div>
  );
}
