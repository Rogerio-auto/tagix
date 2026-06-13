'use client';

import { useEffect, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { Skeleton } from '@/shared/components/feedback';
import type { WorkspaceAgentPolicy } from '@/features/platform-admin/lib';
import { Toggle } from '@/features/platform-admin/models/Toggle';
import { usePolicy, useUpdatePolicy, useActiveModels, useWorkspaceList } from './queries';

type Draft = Partial<WorkspaceAgentPolicy>;

const FLAGS: { key: keyof WorkspaceAgentPolicy; label: string; help: string }[] = [
  { key: 'allowStreaming', label: 'Streaming', help: 'Resposta token-a-token.' },
  { key: 'allowInterrupts', label: 'Interrupts', help: 'Human-in-the-loop.' },
  { key: 'allowParallelTools', label: 'Tools em paralelo', help: 'Tool calls simultaneas.' },
  { key: 'allowVision', label: 'Visao', help: 'Input de imagem.' },
  { key: 'allowTranscription', label: 'Transcricao', help: 'Audio para texto.' },
  { key: 'allowPersistentCheckpoints', label: 'Checkpoints persistentes', help: 'Memoria duravel.' },
  { key: 'allowAgentConversions', label: 'Conversoes pelo agente', help: 'Registra conversoes.' },
  { key: 'agentConversionRequireApproval', label: 'Aprovar conversoes', help: 'Confirmacao humana.' },
];

const CAPS: { key: keyof WorkspaceAgentPolicy; label: string; help: string }[] = [
  { key: 'maxIterations', label: 'Max. iteracoes', help: 'Passos do grafo por invocacao.' },
  { key: 'maxToolsPerAgent', label: 'Max. tools/agente', help: 'Tools por agente.' },
  { key: 'maxTokensPerCall', label: 'Max. tokens/chamada', help: 'Multiplicador de custo.' },
  { key: 'maxMonthlyCostUsd', label: 'Teto mensal (USD)', help: 'Vazio = sem teto.' },
  { key: 'maxDailyInvocations', label: 'Max. invocacoes/dia', help: 'Vazio = sem limite.' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h3 className="mb-4 font-head text-sm font-semibold uppercase tracking-wide text-text-low">{title}</h3>
      {children}
    </section>
  );
}

function PolicyForm({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = usePolicy(workspaceId);
  const { data: activeModels } = useActiveModels();
  const update = useUpdatePolicy();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>({});

  useEffect(() => {
    if (data?.policy) setDraft(data.policy);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
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
      toast({ variant: 'error', title: 'Modelo padrao invalido', description: 'Precisa estar entre os permitidos.' });
      return;
    }
    try {
      await update.mutateAsync({ workspaceId, body: draft });
      toast({ variant: 'success', title: 'Politica salva', description: 'Enforcement atualizado.' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao salvar', description: msg });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title="Modelos">
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {(activeModels ?? []).map((m) => (
            <label key={m.id} className="flex items-center gap-3 rounded-md border border-border-2 px-3 py-2">
              <input
                type="checkbox"
                checked={allowed.has(m.slug)}
                onChange={() => toggleModel(m.slug)}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm text-text">{m.displayName}</span>
                <span className="block truncate font-mono text-xs text-text-low">{m.slug}</span>
              </span>
            </label>
          ))}
          {(activeModels ?? []).length === 0 && (
            <p className="text-sm text-text-low">Nenhum modelo ativo. Ative na aba Modelos.</p>
          )}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Modelo padrao</span>
          <select
            value={draft.defaultChatModel ?? ''}
            onChange={(e) => set({ defaultChatModel: e.target.value || null })}
            className="h-10 rounded-md border border-border bg-surface-inset px-3 text-sm text-text outline-none focus-visible:border-border-brand"
          >
            <option value="">nenhum</option>
            {[...allowed].map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
          <span className="text-xs text-text-low">Vazio = herda a allow-list do plano.</span>
        </label>
      </Section>

      <Section title="Features de agente">
        <div className="grid gap-3 sm:grid-cols-2">
          {FLAGS.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3 rounded-md border border-border-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-text">{f.label}</span>
                <span className="block text-xs text-text-low">{f.help}</span>
              </span>
              <Toggle checked={Boolean(draft[f.key])} onChange={(next) => set({ [f.key]: next } as Draft)} label={f.label} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Limites (caps)">
        <div className="grid gap-4 sm:grid-cols-2">
          {CAPS.map((c) => {
            const isNullable = c.key === 'maxMonthlyCostUsd' || c.key === 'maxDailyInvocations';
            return (
              <label key={c.key} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text">{c.label}</span>
                <Input
                  type="number"
                  min={0}
                  value={capValue(c.key)}
                  onChange={(e) => setCap(c.key, e.target.value)}
                  placeholder={isNullable ? 'sem limite' : undefined}
                />
                <span className="text-xs text-text-low">{c.help}</span>
              </label>
            );
          })}
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={update.isPending}>
          {update.isPending ? 'Salvando...' : 'Salvar politica'}
        </Button>
      </div>
    </div>
  );
}

export function PolicyEditor() {
  const { data, isLoading } = useWorkspaceList();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h1 className="font-head text-xl font-semibold text-text">Politicas de agente</h1>
        <p className="mt-1 text-sm text-text-mid">
          Defina por workspace os modelos permitidos, as features de agente e os limites de custo.
        </p>
      </header>

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-sm font-medium text-text">Workspace</span>
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <select
            value={workspaceId ?? ''}
            onChange={(e) => setWorkspaceId(e.target.value || null)}
            className="h-10 rounded-md border border-border bg-surface-inset px-3 text-sm text-text outline-none focus-visible:border-border-brand"
          >
            <option value="">selecione</option>
            {(data?.workspaces ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.slug})
              </option>
            ))}
          </select>
        )}
      </label>

      {workspaceId ? (
        <PolicyForm key={workspaceId} workspaceId={workspaceId} />
      ) : (
        <p className="text-sm text-text-low">Selecione um workspace para editar a politica.</p>
      )}
    </section>
  );
}
