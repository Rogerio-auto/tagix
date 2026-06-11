import { Suspense } from 'react';
import { SettingsPanel } from '@/features/settings/shell';

export const metadata = { title: 'Configurações' };

/**
 * Painel de configurações (F8-S05 / PERMISSIONS.md §5). Substitui o antigo redirect:
 * `/settings` abre o painel 2-colunas (sidebar agrupada + conteúdo lazy da seção).
 * `SettingsPanel` lê `?s=` via useSearchParams → exige Suspense boundary (Next 15).
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPanel />
    </Suspense>
  );
}
