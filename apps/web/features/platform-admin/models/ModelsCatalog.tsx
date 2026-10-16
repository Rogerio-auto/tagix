'use client';

/**
 * Catálogo global de modelos LLM (F25-S07) no DS 3.0 (F72-S08).
 *
 * Ativa/desativa (`is_active`), edita `default_plan_keys`/notas e dispara o Sync
 * OpenRouter com feedback. Desktop: `DataTable` (slug, contexto e preço por 1M tokens em
 * mono; clicar na linha abre o editor). Mobile: lista em que o corpo abre o editor e o
 * interruptor é irmão (nunca botão dentro de botão).
 *
 * UX: §2.1 linha abre o editor; §2.7 botão de sync e interruptor em carregando; §2.9
 * desativar avisa do impacto (o mesmo `confirm` de antes); §2.11 erro em 3 partes.
 * Custo de modelo é legítimo aqui (DS3_ADOCAO §2.7).
 */
import { useState } from 'react';
import { Boxes, Eye, RefreshCw, Wrench } from 'lucide-react';
import { Badge, Button, DataTable, EmptyState, ErrorState, Skeleton, useToast, type DataTableColumn } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatNumber } from '@/shared/lib/locale';
import type { LlmModel } from '@/features/platform-admin/lib';
import { usd } from '../lib/labels';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { useModels, usePatchModel, useSyncModels } from './queries';
import { Toggle } from './Toggle';
import { ModelEditor } from './ModelEditor';

function price(v: number | null): string {
  return v === null ? '—' : usd(v);
}

function contextLabel(n: number | null): string {
  return n ? `${formatNumber(Math.round(n / 1000))}k` : '—';
}

export function ModelsCatalog() {
  const { isMobile } = useBreakpoint();
  const query = useModels();
  const patch = usePatchModel();
  const sync = useSyncModels();
  const { toast } = useToast();
  const [editing, setEditing] = useState<LlmModel | null>(null);

  const models = query.data?.models ?? [];
  const activeCount = models.filter((m) => m.isActive).length;

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
      toast({
        variant: 'success',
        title: 'Sincronizado com a OpenRouter',
        description: `${formatNumber(r.upserted)} de ${formatNumber(r.total)} modelos atualizados.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Falha ao sincronizar.';
      toast({ variant: 'error', title: 'Sync falhou', description: msg });
    }
  };

  const toggleFor = (m: LlmModel) => (
    // Só para a propagação: o interruptor não abre o editor (a linha é a ação primária).
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <Toggle
        checked={m.isActive}
        onChange={() => void onToggle(m)}
        disabled={patch.isPending}
        loading={patch.isPending && patch.variables?.id === m.id}
        label={`${m.isActive ? 'Desativar' : 'Ativar'} ${m.displayName}`}
      />
    </span>
  );

  const caps = (m: LlmModel) => (
    <span className="flex flex-wrap gap-1">
      {m.supportsTools && (
        <Badge size="sm">
          <Wrench className="size-3" aria-hidden />
          Tools
        </Badge>
      )}
      {m.supportsVision && (
        <Badge size="sm">
          <Eye className="size-3" aria-hidden />
          Visão
        </Badge>
      )}
    </span>
  );

  const columns: DataTableColumn<LlmModel>[] = [
    {
      id: 'model',
      header: 'Modelo',
      cell: (m) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-bold text-text">{m.displayName}</span>
          <span className="truncate font-mono text-xs text-text-low">{m.slug}</span>
        </span>
      ),
    },
    {
      id: 'provider',
      header: 'Provider',
      width: '9rem',
      cell: (m) => <span className="truncate font-mono text-sm text-text-mid">{m.upstreamProvider}</span>,
    },
    { id: 'caps', header: 'Recursos', width: '10rem', cell: caps },
    {
      id: 'context',
      header: 'Contexto',
      numeric: true,
      width: '6.5rem',
      cell: (m) => <span className="text-text-mid">{contextLabel(m.contextLength)}</span>,
    },
    {
      id: 'price',
      header: 'Entrada / saída (1M)',
      numeric: true,
      width: '12rem',
      cell: (m) => (
        <span className="whitespace-nowrap text-text">
          {price(m.pricingPromptPer1m)} <span className="text-text-low">/</span> {price(m.pricingCompletionPer1m)}
        </span>
      ),
    },
    { id: 'active', header: 'Ativo', align: 'right', width: '5.5rem', cell: toggleFor },
  ];


  const errorCopy = {
    title: 'Não foi possível carregar os modelos',
    reason: 'O catálogo de modelos não respondeu.',
    whatToDo: 'Verifique se você tem acesso de plataforma e tente novamente.',
  };
  const retry = (
    <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
      Tentar de novo
    </Button>
  );
  const emptyCopy = {
    title: 'Nenhum modelo ainda',
    description: 'Rode o Sync OpenRouter para popular o catálogo.',
  };

  const syncButton = (
    <Button
      variant="secondary"
      loading={sync.isPending}
      leftIcon={<RefreshCw className="size-4" aria-hidden />}
      onClick={() => void onSync()}
    >
      {sync.isPending ? 'Sincronizando…' : 'Sync OpenRouter'}
    </Button>
  );

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/models"
        title="Modelos"
        description={
          query.data ? (
            <span>
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(models.length)}</span> no catálogo ·{' '}
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(activeCount)}</span>{' '}
              {activeCount === 1 ? 'ativo' : 'ativos'}
            </span>
          ) : (
            'Catálogo global de LLMs oferecidos pela plataforma.'
          )
        }
        actions={syncButton}
        help={<p>Preços em dólar por 1 milhão de tokens, como a OpenRouter cobra (entrada / saída).</p>}
      />

      {isMobile ? (
        query.isLoading ? (
          <div role="status" aria-busy="true" aria-label="Carregando modelos" className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState {...errorCopy} action={retry} />
        ) : models.length === 0 ? (
          <EmptyState icon={Boxes} {...emptyCopy} />
        ) : (
          // O corpo do card abre o editor e o interruptor fica AO LADO (irmãos): botão dentro
          // de botão é controle aninhado (axe nested-interactive) e o toque ficaria ambíguo.
          <ul aria-label="Modelos" className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {models.map((m) => (
              <li key={m.id} className="flex items-center gap-2 pr-4">
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  aria-label={`Editar ${m.displayName}`}
                  className="flex min-w-0 flex-1 flex-col gap-1 py-3 pl-4 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:focus-ring"
                >
                  <span className={m.isActive ? 'truncate font-body text-sm font-bold text-text' : 'truncate font-body text-sm font-bold text-text-low'}>
                    {m.displayName}
                  </span>
                  <span className="truncate font-mono text-xs text-text-low">{m.slug}</span>
                  <span className="whitespace-nowrap font-mono text-xs tabular-nums text-text-mid">
                    {contextLabel(m.contextLength)} · {price(m.pricingPromptPer1m)} / {price(m.pricingCompletionPer1m)}
                  </span>
                </button>
                {toggleFor(m)}
              </li>
            ))}
          </ul>
        )
      ) : (
        <DataTable<LlmModel>
          caption="Modelos"
          columns={columns}
          rows={models}
          getRowId={(m) => m.id}
          loading={query.isLoading}
          loadingRows={8}
          onRowClick={setEditing}
          getRowLabel={(m) => `Editar ${m.displayName}`}
          getRowState={(m) => (m.isActive ? undefined : 'muted')}
          error={query.isError ? <ErrorState {...errorCopy} action={retry} /> : undefined}
          empty={<EmptyState icon={Boxes} {...emptyCopy} />}
        />
      )}

      {editing && <ModelEditor model={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
