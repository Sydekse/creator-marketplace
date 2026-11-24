import { guard } from '@/lib/authz';
import { getDeadlineDetail } from '@/lib/deals/deadline-requests';
import { DeadlineCard } from './deadline-card';

export async function DeadlineSection({ dealId }: { dealId: string }) {
  const ctx = await guard({
    roles: ['brand', 'creator', 'admin'],
    resource: { kind: 'deal', id: dealId },
    allowAdmin: true,
  });
  const data = await getDeadlineDetail(dealId, {
    userId: ctx.user.id,
    role: ctx.user.role,
  });
  if (!data) return null;
  return (
    <DeadlineCard
      data={data}
      role={ctx.user.role}
      userId={ctx.user.id}
      now={new Date()}
    />
  );
}
