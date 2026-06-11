/**
 * Feature dashboard (F8-S03). Server-driven, role-aware. O Server Component
 * (`app/(app)/page.tsx`) renderiza o `DashboardClient`, que carrega `/dashboard/me`,
 * hidrata, escuta socket e renderiza cards via registry por tipo.
 */
export { DashboardClient } from './DashboardClient';
export type {
  DashboardPayload,
  DashboardCard,
  DashboardAlert,
  DashboardRole,
} from './types';
