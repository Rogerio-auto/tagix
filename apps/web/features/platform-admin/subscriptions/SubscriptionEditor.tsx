'use client';

/**
 * Assinatura por tenant (F26-S08) no DS 3.0 (F72-S08) -- trocar plano/status/trial/ciclo
 * + override "custom plan" (limites/features que sobrepõem o plano), mostrando os
 * entitlements EFETIVOS resolvidos (override > plano). Consome F26-S04. Sem Stripe.
 *
 * Fluxo inalterado: os mesmos payloads (`useUpdateSubscription`/`useUpdateOverrides`) e o
 * MESMO `window.confirm` para status de impacto (cancelada, expirada, inadimplente; UX
 * §2.9). Novo só o feedback: toast de sucesso/erro (UX §2.7) e erro de carga em 3 partes.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Building2, Sparkles } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { SUBSCRIPTION_STATUSES, subscriptionStatus } from '../lib/labels';
import { FEATURE_LABEL, LIMIT_LABEL } from '../plans/labels';
import { FEATURE_KEYS, LIMIT_KEYS, type FeatureKey, type LimitKey } from '../plans/queries';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { checkboxClass, controlClass, eyebrowClass, FieldLabel, Panel } from '../ui/kit';
import {
  type OverrideUpdate,
  type SubscriptionUpdate,
  usePlansForSelect,
  useSubscription,
  useTenantSelector,
  useUpdateOverrides,
  useUpdateSubscription,
} from './queries';

const DESTRUCTIVE = new Set(['canceled', 'expired', 'past_due']);

function SubscriptionPanel({ workspaceId }: { workspaceId: string }) {
  const query = useSubscription(workspaceId);
  const sub = query.data;
  const { data: plansData } = usePlansForSelect();
  const updateSub = useUpdateSubscription(workspaceId);
  const updateOv = useUpdateOverrides(workspaceId);
  const { toast } = useToast();

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

  if (query.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar a assinatura"
        reason="A assinatura deste tenant não respondeu."
        whatToDo="Verifique a conexão e tente novamente."
        action={
          <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  if (query.isLoading || !sub) {
    return (
      <div role="status" aria-busy="true" aria-label="Carregando a assinatura" className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  async function saveSubscription() {
    if (form.status && DESTRUCTIVE.has(form.status) && form.status !== sub!.status) {
      const label = subscriptionStatus(form.status).label;
      if (!window.confirm(`Mudar o status para "${label}"? Isso afeta o acesso do tenant.`)) return;
    }
    try {
      await updateSub.mutateAsync(form);
      toast({ variant: 'success', title: 'Assinatura salva' });
    } catch {
      toast({ variant: 'error', title: 'Não foi possível salvar a assinatura', description: 'Tente novamente.' });
    }
  }

  async function saveOverrides() {
    try {
      await updateOv.mutateAsync(ov);
      toast({ variant: 'success', title: 'Override salvo' });
    } catch {
      toast({ variant: 'error', title: 'Não foi possível salvar o override', description: 'Tente novamente.' });
    }
  }

  const ent = sub.entitlements;
  const effectiveLimits = Object.entries(ent.limits) as [LimitKey, number][];
  const effectiveFeatures = (Object.entries(ent.features) as [FeatureKey, boolean][]).filter(([, v]) => v);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <Panel
          title="Assinatura"
          titleId="sub-main"
          footer={
            <Button variant="primary" loading={updateSub.isPending} onClick={() => void saveSubscription()}>
              {updateSub.isPending ? 'Salvando…' : 'Salvar assinatura'}
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Plano">
              <select
                value={form.planId ?? ''}
                onChange={(e) => setForm({ ...form, planId: e.target.value || null })}
                className={controlClass}
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
            </FieldLabel>
            <FieldLabel label="Status">
              <select
                value={form.status ?? ''}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={controlClass}
              >
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {subscriptionStatus(s).label}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Ciclo">
              <select
                value={form.billingCycle ?? 'monthly'}
                onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}
                className={controlClass}
              >
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </FieldLabel>
            <FieldLabel label="Teste até">
              <input
                type="date"
                value={form.trialEndsAt ? form.trialEndsAt.slice(0, 10) : ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    trialEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
                className={cn(controlClass, 'font-mono tabular-nums')}
              />
            </FieldLabel>
          </div>
        </Panel>

        <Panel
          title="Override (custom plan)"
          titleId="sub-override"
          description="Sobrepõe limites e features do plano só para este tenant. Vazio herda do plano."
          footer={
            <Button variant="secondary" loading={updateOv.isPending} onClick={() => void saveOverrides()}>
              {updateOv.isPending ? 'Salvando…' : 'Salvar override'}
            </Button>
          }
        >
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {LIMIT_KEYS.map((k) => (
                <Input
                  key={k}
                  label={LIMIT_LABEL[k]}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="font-mono tabular-nums"
                  value={ov.limits[k] ?? ''}
                  placeholder={ent.planLimits[k] != null ? `plano: ${formatNumber(ent.planLimits[k])}` : 'sem limite'}
                  onChange={(e) =>
                    setOv({
                      ...ov,
                      limits: { ...ov.limits, [k]: e.target.value === '' ? undefined : Number(e.target.value) },
                    })
                  }
                />
              ))}
            </div>
            <fieldset>
              <legend className={cn(eyebrowClass, 'mb-2')}>Features</legend>
              <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {FEATURE_KEYS.map((k) => (
                  <label
                    key={k}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 font-body text-sm text-text transition-colors duration-(--dur-fast) hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(ov.features[k])}
                      onChange={(e) => setOv({ ...ov, features: { ...ov.features, [k]: e.target.checked } })}
                      className={checkboxClass}
                    />
                    {FEATURE_LABEL[k]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Panel>
      </div>

      <Panel
        title="Entitlements efetivos"
        titleId="sub-effective"
        icon={Sparkles}
        description="O que o tenant tem agora: override vence o plano."
        className="lg:sticky lg:top-24"
      >
        <div className="flex flex-col gap-5">
          {effectiveLimits.length > 0 ? (
            <dl className="divide-y divide-border">
              {effectiveLimits.map(([k, v]) => {
                const overridden = ent.overrideLimits[k] != null;
                return (
                  <div key={k} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                    <dt className="flex min-w-0 items-center gap-2 font-body text-sm text-text-low">
                      <span className="truncate">{LIMIT_LABEL[k] ?? k}</span>
                      {overridden && (
                        <Badge tone="brand" size="sm">
                          override
                        </Badge>
                      )}
                    </dt>
                    <dd className="font-mono text-sm tabular-nums text-text">{formatNumber(v)}</dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p className="font-body text-sm text-text-low">Sem limites: tudo liberado.</p>
          )}
          <div>
            <p className={cn(eyebrowClass, 'mb-2')}>Features</p>
            {effectiveFeatures.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {effectiveFeatures.map(([k]) => {
                  const overridden = ent.overrideFeatures[k] != null;
                  return (
                    <li key={k}>
                      <Badge tone={overridden ? 'brand' : 'neutral'} size="sm">
                        {FEATURE_LABEL[k] ?? k}
                        {overridden ? ' · override' : ''}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="font-body text-sm text-text-low">Nenhuma feature extra.</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function SubscriptionEditor() {
  const params = useSearchParams();
  const initial = params.get('workspace') ?? '';
  const [workspaceId, setWorkspaceId] = useState(initial);
  const { data: tenants, isLoading } = useTenantSelector();
  const current = tenants?.tenants.find((t) => t.id === workspaceId);

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/subscriptions"
        title="Assinaturas"
        description={
          current ? (
            <span>
              {current.name} · <span className="font-mono text-text-mid">{current.slug}</span>
            </span>
          ) : (
            'Plano, status, teste e override por tenant. Gestão interna (sem cobrança).'
          )
        }
      />

      <div className="flex flex-col gap-6">
        <div className="max-w-md">
          {isLoading ? (
            <Skeleton className="h-16 rounded-sm" />
          ) : (
            <FieldLabel label="Tenant">
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className={controlClass}>
                <option value="">Selecione um tenant…</option>
                {tenants?.tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.slug})
                  </option>
                ))}
              </select>
            </FieldLabel>
          )}
        </div>

        {workspaceId ? (
          <SubscriptionPanel key={workspaceId} workspaceId={workspaceId} />
        ) : (
          <EmptyState
            icon={Building2}
            title="Escolha um tenant"
            description="Selecione acima o workspace cuja assinatura você quer ver ou ajustar."
          />
        )}
      </div>
    </div>
  );
}
