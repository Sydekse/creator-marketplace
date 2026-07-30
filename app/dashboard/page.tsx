import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { roleHomePath } from '@/lib/navigation';

/**
 * Role-neutral entry point. Anything that just wants "send me where I belong"
 * links here and lets the server decide, so no client ever has to map a role to
 * a path (NFR-005).
 */
export default async function DashboardPage() {
  const user = await requireUser();
  redirect(roleHomePath(user.role));
}
