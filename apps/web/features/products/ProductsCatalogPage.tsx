'use client';

/**
 * Wrapper de página do catálogo (F47-S05). Gate de UI defensivo por `product.edit`
 * — a seção já fica escondida no registry de settings para quem não pode, mas a
 * rota é alcançável por URL direta. O backend (S02 + RLS) é a autoridade; aqui só
 * evitamos renderizar uma tela de ação que o usuário não conseguiria usar (fail-
 * closed enquanto a sessão hidrata, UX §2.11).
 */
import { ShieldAlert } from 'lucide-react';
import { can } from '@hm/shared';
import { EmptyState } from '@/shared/components/feedback/EmptyState';
import { Skeleton } from '@/shared/components/feedback/Skeleton';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ProductsCatalog } from './ProductsCatalog';

export function ProductsCatalogPage(): React.JSX.Element {
  const role = useAuthStore((s) => s.auth?.role);
  const status = useAuthStore((s) => s.status);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy aria-label="Carregando">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (role == null || !can(role, 'product.edit')) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="A gestão do catálogo de produtos é exclusiva de administradores do workspace."
      />
    );
  }

  return <ProductsCatalog />;
}
