'use client';

/**
 * Editor de política de agente por workspace (F25-S07) no DS 3.0 (F72-S08): modelos
 * permitidos, features de agente e limites de custo. Mesmo payload de antes
 * (`useUpdatePolicy({ workspaceId, body: draft })`) e a mesma validação do modelo padrão.
 *
 * UX: §2.5 `?` no título; §2.6 vazio guia a escolha do workspace; §2.7 skeleton e botão
 * em carregando; §2.8 seções curtas em vez de um mega-form; §2.11 erro de carga em 3 partes.
 */
import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, Skeleton, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import type { WorkspaceAgentPolicy } from '@/features/platform-admin/lib';
import { Toggle } from '@/features/platform-admin/models/Toggle';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { checkboxClass, controlClass, FieldLabel, Panel } from '../ui/kit';
import { usePolicy, useUpdatePolicy, useActiveModels, useWorkspaceList } from './queries';

type Draft = Partial<WorkspaceAgentPolicy>;

const FLAGS: { key: keyof WorkspaceAgentPolicy; label: string; help: string }[] = [
  { key: 'allowStreaming', label: 'Streaming', help: 'Resposta token a token.' },
  { key: 'allowInterrupts', label: 'Interrupts', help: 'Human-in-the-loop.' },
  { key: 'allowParallelTools', label: 'Tools em paralelo', help: 'Tool calls simultâneas.' },
  { key: 'allowVision', label: 'Visão', help: 'Entrada de imagem.' },
  { key: 'allowTranscription', label: 'Transcrição', help: 'Áudio para texto.' },
  { key: 'allowPersistentCheckpoints', label: 'Checkpoints persistentes', help: 'Memória durável.' },
  { key: 'allowAgentConversions', label: 'Conversões pelo agente', help: 'Registra conversões.' },
  { key: 'agentConversionRequireApproval', label: 'Aprovar conversões', help: 'Confirmação humana.' },
];

const CAPS: { key: keyof WorkspaceAgentPolicy; label: string; help: string }[] = [
  { key: 'maxIterations', label: 'Máx. iterações', help: 'Passos do grafo por invocação.' },
  { key: 'maxToolsPerAgent', label: 'Máx. tools por agente', help: 'Tools por agente.' },
  { key: 'maxTokensPerCall', label: 'Máx. tokens por chamada', help: 'Multiplicador de custo.' },
  { key: 'maxMonthlyCostUsd', label: 'Teto mensal (USD)', help: 'Vazio = sem teto.' },
  { key: 'maxDailyInvocations', label: 'Máx. invocações por dia', help: 'Vazio = sem limite.' },
];

function PolicyForm({ workspaceId }: { workspaceId: string }) {
  const query = usePolicy(workspaceId);
  const { data: activeModels } = useActiveModels();
  const update = useUpdatePolicy();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>({});

  useEffect(() => {
    if (query.data?.policy) setDraft(query.data.policy);
  }, [query.data]);

  if (query.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar a política"
        reason="A política deste workspace não respondeu."
        whatToDo="Verifique a conexão e tente novamente."
        reference={query.error instanceof ApiError ? query.error.ref : undefined}
        action={
          <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  if (query.isLoading || !query.data) {
    return (
      <div role="status" aria-busy="true" aria-label="Carregando a política" className="flex flex-col gap-4">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  const set = (patch: Draft) => setDraft((d) => ({ ...d, ...patch }));
  const allowed = new Set(draft.allowedModels ?? []);

  const toggleModel = (slug: string) => {
    const next = new Set(allowed);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    set({ allowedModels: [...next] });
  };

  const capValue = (key: keyof WorkspaceAgentPolicy): string => {
    const v = draft[key];
    return v === null || v === undefined ? '' : String(v);
  };

  const setCap = (key: keyof WorkspaceAgentPolicy, raw: string) => {
    if (raw === '') {
      set({ [key]: null } as Draft);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) set({ [key]: n } as Draft);
  };

  const save = async () => {
    if (draft.defaultChatModel && (draft.allowedModels?.length ?? 0) > 0 && !allowed.has(draft.defaultChatModel)) {
      toast({ variant: 'error', title: 'Modelo padrão inválido', description: 'Precisa estar entre os permitidos.' });
      return;
    }
    try {
      await update.mutateAsync({ workspaceId, body: draft });
      toast({ variant: 'success', title: 'Política salva', description: 'Enforcement atualizado.' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao salvar', description: msg });
    }
  };

  const models = activeModels ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Modelos"
        titleId="policy-models"
        description="Quais LLMs os agentes deste workspace podem usar. Nenhum marcado herda a lista do plano."
      >
        <div className="flex flex-col gap-5">
          {models.length === 0 ? (
            <p className="font-body text-sm text-text-low">Nenhum modelo ativo. Ative em Modelos.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {models.map((m) => {
                const on = allowed.has(m.slug);
                return (
                  <label
                    key={m.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 transition-colors duration-(--dur-fast)',
                      on ? 'border-brand-text/30 bg-brand-text/5' : 'border-border hover:border-border-2 hover:bg-surface-2',
                    )}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleModel(m.slug)} className={checkboxClass} />
                    <span className="min-w-0">
                      <span className="block truncate font-body text-sm font-semibold text-text">{m.displayName}</span>
                      <span className="block truncate font-mono text-xs text-text-low">{m.slug}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <FieldLabel label="Modelo padrão" hint="Vazio herda a allow-list do plano." className="max-w-md">
            <select
              value={draft.defaultChatModel ?? ''}
              onChange={(e) => set({ defaultChatModel: e.target.value || null })}
              className={cn(controlClass, 'font-mono')}
            >
              <option value="">nenhum</option>
              {[...allowed].map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
          </FieldLabel>
        </div>
      </Panel>

      <Panel title="Features de agente" titleId="policy-flags" body="flush">
        <ul className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          {FLAGS.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-4 px-5 py-3 sm:border-b sm:border-border sm:odd:border-r"
            >
              <span className="min-w-0">
                <span className="block font-body text-sm font-semibold text-text">{f.label}</span>
                <span className="block font-body text-sm text-text-low">{f.help}</span>
              </span>
              <Toggle checked={Boolean(draft[f.key])} onChange={(next) => set({ [f.key]: next } as Draft)} label={f.label} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Limites"
        titleId="policy-caps"
        footer={
          <Button variant="primary" loading={update.isPending} onClick={() => void save()}>
            {update.isPending ? 'Salvando…' : 'Salvar política'}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {CAPS.map((c) => {
            const isNullable = c.key === 'maxMonthlyCostUsd' || c.key === 'maxDailyInvocations';
            return (
              <Input
                key={c.key}
                label={c.label}
                hint={c.help}
                type="number"
                inputMode="decimal"
                min={0}
                className="font-mono tabular-nums"
                value={capValue(c.key)}
                onChange={(e) => setCap(c.key, e.target.value)}
                placeholder={isNullable ? 'sem limite' : undefined}
              />
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

export function PolicyEditor() {
  const { data, isLoading } = useWorkspaceList();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const current = data?.workspaces.find((w) => w.id === workspaceId);

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/policies"
        title="Políticas de agente"
        description={
          current ? (
            <span>
              {current.name} · <span className="font-mono text-text-mid">{current.slug}</span>
            </span>
          ) : (
            'Modelos permitidos, features de agente e limites de custo por workspace.'
          )
        }
      />

      <div className="flex flex-col gap-6">
        <div className="max-w-md">
          {isLoading ? (
            <Skeleton className="h-16 rounded-sm" />
          ) : (
            <FieldLabel label="Workspace">
              <select
                value={workspaceId ?? ''}
                onChange={(e) => setWorkspaceId(e.target.value || null)}
                className={controlClass}
              >
                <option value="">Selecione…</option>
                {(data?.workspaces ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.slug})
                  </option>
                ))}
              </select>
            </FieldLabel>
          )}
        </div>

        {workspaceId ? (
          <PolicyForm key={workspaceId} workspaceId={workspaceId} />
        ) : (
          <EmptyState
            icon={Building2}
            title="Escolha um workspace"
            description="Selecione acima o workspace cuja política de agente você quer ver ou ajustar."
          />
        )}
      </div>
    </div>
  );
}
