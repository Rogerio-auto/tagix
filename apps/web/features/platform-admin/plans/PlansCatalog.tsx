'use client';

/**
 * Catalogo de Planos (F26-S08) -- CRUD com editor TIPADO de limits/features em secoes
 * (UX 2.8: nao um mega-form). Soft-delete pede confirmacao (2.9). Consome F26-S03.
 * DS v2 dark-first (tokens, zero hex). Sem Stripe (gestao interna).
 */
import { useState } from 'react';
import { Plus, Power } from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  type FeatureKey,
  type LimitKey,
  type Plan,
  type PlanInput,
  useCreatePlan,
  useDeactivatePlan,
  usePlans,
  useUpdatePlan,
} from './queries';

const LIMIT_LABEL: Record<LimitKey, string> = {
  max_agents: 'Agentes',
  max_channels: 'Canais',
  max_members: 'Membros',
  max_monthly_messages: 'Mensagens/mes',
  max_flows: 'Flows',
  max_knowledge_documents: 'Documentos KB',
};
const FEATURE_LABEL: Record<FeatureKey, string> = {
  instagram: 'Instagram',
  flows: 'Flow Builder',
  api_access: 'API publica',
  campaigns: 'Campanhas',
  calendar: 'Calendario',
  knowledge_base: 'Base de conhecimento',
};

function emptyDraft(): PlanInput {
  return {
    key: '',
    name: '',
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    limits: {},
    features: {},
    position: 0,
  };
}

function PlanEditor({ initial, onClose }: { initial: Plan | null; onClose: () => void }) {
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const [draft, setDraft] = useState<PlanInput>(
    initial
      ? {
          key: initial.key,
          name: initial.name,
          description: initial.description,
          priceMonthlyCents: initial.priceMonthlyCents,
          priceYearlyCents: initial.priceYearlyCents,
          limits: { ...initial.limits },
          features: { ...initial.features },
          position: initial.position,
        }
      : emptyDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  async function save() {
    setError(null);
    try {
      if (initial) await update.mutateAsync({ id: initial.id, input: draft });
      else await create.mutateAsync(draft);
      onClose();
    } catch {
      setError('Nao foi possivel salvar. Verifique a chave (unica) e os campos.');
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface-1 p-5">
      <h3 className="text-sm font-semibold text-text-high">
        {initial ? `Editar plano: ${initial.name}` : 'Novo plano'}
      </h3>

      <section className="flex flex-col gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-text-low">Identificacao e preco</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Chave (slug)</span>
            <input
              value={draft.key}
              disabled={Boolean(initial)}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high disabled:opacity-50 focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Nome</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Preco mensal (centavos)</span>
            <input
              type="number"
              value={draft.priceMonthlyCents ?? 0}
              onChange={(e) => setDraft({ ...draft, priceMonthlyCents: Number(e.target.value) })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Preco anual (centavos)</span>
            <input
              type="number"
              value={draft.priceYearlyCents ?? 0}
              onChange={(e) => setDraft({ ...draft, priceYearlyCents: Number(e.target.value) })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-text-low">Limites</h4>
        <div className="grid gap-3 md:grid-cols-3">
          {LIMIT_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className="text-text-mid">{LIMIT_LABEL[k]}</span>
              <input
                type="number"
                value={draft.limits?.[k] ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    limits: {
                      ...draft.limits,
                      [k]: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  })
                }
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-text-low">Features</h4>
        <div className="grid gap-2 md:grid-cols-3">
          {FEATURE_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm text-text-mid">
              <input
                type="checkbox"
                checked={Boolean(draft.features?.[k])}
                onChange={(e) =>
                  setDraft({ ...draft, features: { ...draft.features, [k]: e.target.checked } })
                }
                className="size-4 rounded border-border bg-surface-2 accent-accent"
              />
              {FEATURE_LABEL[k]}
            </label>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-high">
          Cancelar
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || !draft.key || !draft.name}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

export function PlansCatalog() {
  const { data, isLoading } = usePlans();
  const deactivate = useDeactivatePlan();
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  async function onDeactivate(plan: Plan) {
    const msg = `Desativar o plano "${plan.name}"? Assinaturas existentes nao mudam, mas ele sai do catalogo.`;
    if (!window.confirm(msg)) return;
    await deactivate.mutateAsync(plan.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-high">Planos</h1>
          <p className="text-sm text-text-mid">
            Catalogo comercial -- limites/features tipados. Gestao interna (sem cobranca).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditing(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-surface-0"
        >
          <Plus className="size-4" aria-hidden /> Novo plano
        </button>
      </header>

      {creating && <PlanEditor initial={null} onClose={() => setCreating(false)} />}
      {editing && <PlanEditor initial={editing} onClose={() => setEditing(null)} />}

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data?.plans.map((p) => (
            <article
              key={p.id}
              className={`flex flex-col gap-3 rounded-xl border p-5 ${p.isActive ? 'border-border bg-surface-1' : 'border-border/50 bg-surface-1/50 opacity-70'}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-text-high">{p.name}</h2>
                  <span className="text-xs text-text-low">{p.key}</span>
                </div>
                <span className="font-mono text-sm text-text-mid">
                  ${(p.priceMonthlyCents / 100).toFixed(2)}/mes
                </span>
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {Object.entries(p.limits).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-surface-3 px-2 py-0.5 text-text-mid">
                    {LIMIT_LABEL[k as LimitKey] ?? k}: {v}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {Object.entries(p.features)
                  .filter(([, v]) => v)
                  .map(([k]) => (
                    <span key={k} className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">
                      {FEATURE_LABEL[k as FeatureKey] ?? k}
                    </span>
                  ))}
              </div>
              <div className="mt-auto flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(p);
                    setCreating(false);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-high"
                >
                  Editar
                </button>
                {p.isActive && (
                  <button
                    type="button"
                    onClick={() => onDeactivate(p)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-text-mid hover:text-danger"
                  >
                    <Power className="size-3.5" aria-hidden /> Desativar
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
