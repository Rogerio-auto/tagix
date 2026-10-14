/**
 * Feature dashboard. A Home (F72-S04) é o Server Component fino em `app/(app)/page.tsx`
 * que renderiza o `HomeClient`: resultado e atenção no topo (`/api/dashboard/home`,
 * recortado por papel no servidor) e, abaixo, o painel completo server-driven de
 * `/api/dashboard/me` com o layout pessoal preservado.
 */
export { HomeClient } from './home/HomeClient';
export type {
  DashboardPayload,
  DashboardCard,
  DashboardAlert,
  DashboardRole,
} from './types';
