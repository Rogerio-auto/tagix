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
import { RefreshCw } from 'lucide-react';
import { ApiError } from '@/shared/lib/api-client';
import { Skeleton } from '@/shared/components/feedback';
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

  return (
    <section className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-4">
        <div>
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

      {isLoading && (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <p className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-text">
          Não foi possível carregar os modelos. Você tem acesso de plataforma?
        </p>
      )}

      {data && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-low">
              <tr>
                <th className="px-4 py-2.5 font-medium">Modelo</th>
                <th className="px-4 py-2.5 font-medium">Provider</th>
                <th className="px-4 py-2.5 font-medium">Contexto</th>
                <th className="px-4 py-2.5 font-medium">Preço (in/out)</th>
                <th className="px-4 py-2.5 font-medium">Ativo</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.models.map((m) => (
                <tr key={m.id} className="text-text-mid hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text">{m.displayName}</div>
                    <div className="font-mono text-xs text-text-low">{m.slug}</div>
                  </td>
                  <td className="px-4 py-3">{m.upstreamProvider}</td>
                  <td className="px-4 py-3">{m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}k` : '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {priceLabel(m.pricingPromptPer1m)} / {priceLabel(m.pricingCompletionPer1m)}
                  </td>
                  <td className="px-4 py-3">
                    <Toggle checked={m.isActive} onChange={() => void onToggle(m)} disabled={patch.isPending} label={`Ativar ${m.slug}`} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
              {data.models.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-text-low">
                    Nenhum modelo ainda. Rode o Sync OpenRouter para popular o catálogo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ModelEditor model={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
