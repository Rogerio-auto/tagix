import { DashboardClient } from '@/features/dashboard';

export const metadata = { title: 'Dashboard' };

/**
 * Dashboard root (F8-S03 / DASHBOARD.md §9.1). Server Component fino que renderiza
 * o shell client `DashboardClient` — este carrega `/dashboard/me` (cards/alerts já
 * filtrados por role pelo servidor), hidrata e escuta o socket. Server-driven: a
 * página nunca decide visibilidade por role.
 */
export default function DashboardPage() {
  return <DashboardClient />;
}
