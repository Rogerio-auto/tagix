'use client';

/**
 * LlmModelsCatalog (F25-S07) — tabela da whitelist global de modelos.
 *
 * Ativa/desativa (toggle is_active), edita default_plan_keys/notes inline, e
 * dispara o Sync OpenRouter com feedback de progresso/resultado. Consome a API
 * F25-S02 via hooks. DS v2 dark-first, tokens semânticos (zero hex). UX §2.9
 * (desativar modelo em uso avisa do impacto), §2.7 (feedback no sync/save), §3.6
 * (skeleton no carregamento).
 */
import { useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { Boxes, RefreshCw } from 'lucide-react';
import { ApiError } from '@/shared/lib/api-client';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
import type { LlmModel } from '@/features/platform-admin/lib';
import { useModels, usePatchModel, useSyncModels } from './queries';
import { Toggle } from './Toggle';
import { ModelEditor } from './ModelEditor';

function priceLabel(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}/1M`;
}

export function ModelsCatalog() {
  const { data, isLoading, isError } = useModels();
  const patch = usePatchModel();
  const sync = useSyncModels();
  const { toast } = useToast();
  const [editing, setEditing] = useState<LlmModel | null>(null);

  const onToggle = async (m: LlmModel) => {
    const next = !m.isActive;
    // §2.9 botão-suicida: desativar é destrutivo p/ quem usa o modelo.
    if (!next && !confirm(`Desativar "${m.displayName}"? Workspaces que usam este modelo deixam de poder selecioná-lo.`)) {
      return;
    }
    try {
      await patch.mutateAsync({ id: m.id, patch: { isActive: next } });
      toast({ variant: 'success', title: next ? 'Modelo ativado' : 'Modelo desativado', description: m.slug });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao atualizar o modelo', description: msg });
    }
  };

  const onSync = async () => {
    try {
      const r = await sync.mutateAsync();
      toast({ variant: 'success', title: 'Sincronizado com a OpenRouter', description: `${r.upserted} de ${r.total} modelos atualizados.` });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Falha ao sincronizar.';
      toast({ variant: 'error', title: 'Sync falhou', description: msg });
    }
  };

  const columns: ResponsiveColumn<LlmModel>[] = [
    {
      id: 'model',
      header: 'Modelo',
      card: 'primary',
      cell: (m) => (
        <div>
          <div className="font-medium text-text">{m.displayName}</div>
          <div className="font-mono text-xs text-text-low">{m.slug}</div>
        </div>
      ),
    },
    { id: 'provider', header: 'Provider', cell: (m) => m.upstreamProvider },
    {
      id: 'context',
      header: 'Contexto',
      cell: (m) => (m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}k` : '—'),
    },
    {
      id: 'price',
      header: 'Preço (in/out)',
      className: 'whitespace-nowrap',
      cell: (m) => `${priceLabel(m.pricingPromptPer1m)} / ${priceLabel(m.pricingCompletionPer1m)}`,
    },
    {
      id: 'active',
      header: 'Ativo',
      card: 'badge',
      cell: (m) => (
        <Toggle
          checked={m.isActive}
          onChange={() => void onToggle(m)}
          disabled={patch.isPending}
          label={`Ativar ${m.slug}`}
        />
      ),
    },
    {
      id: 'edit',
      align: 'right',
      card: 'meta',
      cell: (m) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
          Editar
        </Button>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-head text-xl font-semibold text-text">Modelos</h1>
          <p className="mt-1 text-sm text-text-mid">
            Catálogo global de LLMs. Ative o que a plataforma oferece e sincronize com a OpenRouter.
          </p>
        </div>
        <Button variant="secondary" onClick={onSync} disabled={sync.isPending}>
          <RefreshCw className={sync.isPending ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
          {sync.isPending ? 'Sincronizando…' : 'Sync OpenRouter'}
        </Button>
      </header>

      <ResponsiveTable
        ariaLabel="Modelos"
        rows={data?.models ?? []}
        columns={columns}
        getRowId={(m) => m.id}
        isLoading={isLoading}
        isError={isError}
        skeletonRows={6}
        empty={{
          icon: Boxes,
          title: 'Nenhum modelo ainda',
          description: 'Rode o Sync OpenRouter para popular o catálogo.',
        }}
        error={{
          title: 'Não foi possível carregar os modelos',
          whatToDo: 'Verifique se você tem acesso de plataforma e tente novamente.',
        }}
      />

      {editing && <ModelEditor model={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
