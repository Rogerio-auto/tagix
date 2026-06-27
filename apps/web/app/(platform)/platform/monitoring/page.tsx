import { SyncHealthPanel } from '@/features/platform-admin/monitoring';

export const metadata = { title: 'Plataforma — Monitoramento' };

// F52-S09: painel operacional de saúde da sincronização (filas/DLQ/ticks/canais).
// Vive na área platform-admin (super-admin) — é ferramenta de infra, não do
// workspace. O acesso é gated pelo guard do route group (platform) + o backend
// (GET /api/monitoring/sync-health → 403 fora de OWNER/ADMIN/platform-admin).
export default function PlatformMonitoringPage() {
  return <SyncHealthPanel />;
}
