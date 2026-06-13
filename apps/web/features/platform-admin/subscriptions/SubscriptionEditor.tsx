'use client';

/**
 * Assinatura por tenant (F26-S08) -- trocar plano/status/trial/cycle + override
 * "custom plan" (limites/features que sobrepoem o plano), mostrando os entitlements
 * EFETIVOS resolvidos (override > plano). Consome F26-S04. DS v2 dark-first. Sem Stripe.
 * Acoes de impacto (downgrade/cancelar) confirmam (UX 2.9).
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@/shared/components/feedback';
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  type FeatureKey,
  type LimitKey,
} from '../plans/queries';
import {
  type OverrideUpdate,
  type SubscriptionUpdate,
  usePlansForSelect,
  useSubscription,
  useTenantSelector,
  useUpdateOverrides,
  useUpdateSubscription,
} from './queries';

const STATUSES = ['trial', 'active', 'past_due', 'canceled', 'expired'] as const;
const DESTRUCTIVE = new Set(['canceled', 'expired', 'past_due']);

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

function SubscriptionPanel({ workspaceId }: { workspaceId: string }) {
  const { data: sub, isLoading } = useSubscription(workspaceId);
  const { data: plansData } = usePlansForSelect();
  const updateSub = useUpdateSubscription(workspaceId);
  const updateOv = useUpdateOverrides(workspaceId);

  const [form, setForm] = useState<SubscriptionUpdate>({});
  const [ov, setOv] = useState<OverrideUpdate>({ limits: {}, features: {} });

  useEffect(() => {
    if (sub) {
      setForm({
        planId: sub.planId,
        status: sub.status,
        billingCycle: sub.billingCycle,
        trialEndsAt: sub.trialEndsAt,
      });
      setOv({
        limits: { ...sub.entitlements.overrideLimits },
        features: { ...sub.entitlements.overrideFeatures },
      });
    }
  }, [sub]);

  if (isLoading || !sub) return <Skeleton className="h-64 w-full rounded-xl" />;

  async function saveSubscription() {
    if (form.status && DESTRUCTIVE.has(form.status) && form.status !== sub!.status) {
      if (!window.confirm(`Mudar o status para "${form.status}"? Isso afeta o acesso do tenant.`)) return;
    }
    await updateSub.mutateAsync(form);
  }

  async function saveOverrides() {
    await updateOv.mutateAsync(ov);
  }

  const ent = sub.entitlements;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="text-sm font-semibold text-text-high">Assinatura</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Plano</span>
            <select
              value={form.planId ?? ''}
              onChange={(e) => setForm({ ...form, planId: e.target.value || null })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
            >
              <option value="">Sem plano</option>
              {plansData?.plans
                .filter((p) => p.isActive || p.id === sub.planId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Status</span>
            <select
              value={form.status ?? ''}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Ciclo</span>
            <select
              value={form.billingCycle ?? 'monthly'}
              onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
            >
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-mid">Trial ate</span>
            <input
              type="date"
              value={form.trialEndsAt ? form.trialEndsAt.slice(0, 10) : ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  trialEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveSubscription}
            disabled={updateSub.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
          >
            {updateSub.isPending ? 'Salvando...' : 'Salvar assinatura'}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="text-sm font-semibold text-text-high">Override (custom plan)</h2>
        <p className="text-xs text-text-low">
          Sobrepoe limites/features do plano para este tenant. Deixe vazio para herdar do plano.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {LIMIT_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className="text-text-mid">{LIMIT_LABEL[k]}</span>
              <input
                type="number"
                value={ov.limits[k] ?? ''}
                placeholder={ent.planLimits[k] != null ? `plano: ${ent.planLimits[k]}` : 'sem limite'}
                onChange={(e) =>
                  setOv({
                    ...ov,
                    limits: { ...ov.limits, [k]: e.target.value === '' ? undefined : Number(e.target.value) },
                  })
                }
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high placeholder:text-text-low focus:border-accent focus:outline-none"
              />
            </label>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {FEATURE_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm text-text-mid">
              <input
                type="checkbox"
                checked={Boolean(ov.features[k])}
                onChange={(e) => setOv({ ...ov, features: { ...ov.features, [k]: e.target.checked } })}
                className="size-4 rounded border-border bg-surface-2 accent-accent"
              />
              {FEATURE_LABEL[k]}
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveOverrides}
            disabled={updateOv.isPending}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-high disabled:opacity-50"
          >
            {updateOv.isPending ? 'Salvando...' : 'Salvar override'}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/5 p-5">
        <h2 className="text-sm font-semibold text-text-high">Entitlements efetivos (override &gt; plano)</h2>
        <div className="flex flex-wrap gap-1 text-xs">
          {Object.entries(ent.limits).map(([k, v]) => {
            const overridden = ent.overrideLimits[k as LimitKey] != null;
            return (
              <span
                key={k}
                className={`rounded-full px-2 py-0.5 ${overridden ? 'bg-accent/20 text-accent' : 'bg-surface-3 text-text-mid'}`}
              >
                {LIMIT_LABEL[k as LimitKey] ?? k}: {v}
                {overridden ? ' *' : ''}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          {Object.entries(ent.features)
            .filter(([, v]) => v)
            .map(([k]) => {
              const overridden = ent.overrideFeatures[k as FeatureKey] != null;
              return (
                <span
                  key={k}
                  className={`rounded-full px-2 py-0.5 ${overridden ? 'bg-accent/20 text-accent' : 'bg-surface-3 text-text-mid'}`}
                >
                  {FEATURE_LABEL[k as FeatureKey] ?? k}
                  {overridden ? ' *' : ''}
                </span>
              );
            })}
        </div>
        <p className="text-xs text-text-low">* sobreposto por override deste tenant.</p>
      </section>
    </div>
  );
}

export function SubscriptionEditor() {
  const params = useSearchParams();
  const initial = params.get('workspace') ?? '';
  const [workspaceId, setWorkspaceId] = useState(initial);
  const { data: tenants } = useTenantSelector();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text-high">Assinaturas</h1>
        <p className="text-sm text-text-mid">
          Configure plano, status, trial e override por tenant. Gestao interna (sem cobranca).
        </p>
      </header>

      <label className="flex max-w-md flex-col gap-1 text-sm">
        <span className="text-text-mid">Tenant</span>
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high focus:border-accent focus:outline-none"
        >
          <option value="">Selecione um tenant…</option>
          {tenants?.tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.slug})
            </option>
          ))}
        </select>
      </label>

      {workspaceId ? (
        <SubscriptionPanel workspaceId={workspaceId} />
      ) : (
        <p className="text-sm text-text-low">Selecione um tenant para editar a assinatura.</p>
      )}
    </div>
  );
}
