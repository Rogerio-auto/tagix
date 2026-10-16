'use client';

/**
 * Catálogo de Planos (F26-S08) no DS 3.0 (F72-S08) — CRUD com editor TIPADO de limites e
 * features em seções (UX §2.8: não um mega-form). Consome F26-S03. Sem Stripe.
 *
 * Cards de plano com preço e limites em mono; o editor abre num `Drawer` lateral (UX §2.3:
 * a lista continua visível). Mesmas chamadas de antes (`useCreatePlan`/`useUpdatePlan`/
 * `useDeactivatePlan`), com o MESMO `window.confirm` antes de desativar (UX §2.9); agora
 * com toast de sucesso/erro (UX §2.7) em vez de promessa rejeitada em silêncio.
 *
 * O preço é editado em CENTAVOS, como o contrato da API; o valor formatado aparece ao lado.
 */
import { useState } from 'react';
import { Check, Layers, Pencil, Plus, Power } from 'lucide-react';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  useToast,
} from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { formatMoney, formatNumber } from '@/shared/lib/locale';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { checkboxClass, eyebrowClass } from '../ui/kit';
import { FEATURE_LABEL, LIMIT_LABEL, PLAN_CURRENCY } from './labels';
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

function money(cents: number | undefined): string {
  return formatMoney(cents ?? 0, PLAN_CURRENCY);
}

function PlanEditor({ initial, open, onClose }: { initial: Plan | null; open: boolean; onClose: () => void }) {
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const { toast } = useToast();
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
      toast({ variant: 'success', title: initial ? 'Plano atualizado' : 'Plano criado', description: draft.name });
      onClose();
    } catch {
      setError('Não foi possível salvar. Verifique a chave (única) e os campos.');
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={initial ? `Editar ${initial.name}` : 'Novo plano'}
      description="Limites vazios ficam sem limite. Assinaturas existentes recebem as mudanças."
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {error && (
            <p role="alert" className="mr-auto font-body text-sm text-danger">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={pending} disabled={!draft.key || !draft.name} onClick={() => void save()}>
            {pending ? 'Salvando…' : 'Salvar plano'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-7">
        <section className="flex flex-col gap-4" aria-labelledby="plan-identity">
          <h3 id="plan-identity" className={eyebrowClass}>
            Identificação e preço
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Chave (slug)"
              value={draft.key}
              disabled={Boolean(initial)}
              className="font-mono"
              hint={initial ? 'A chave não muda depois de criada.' : 'Única, em minúsculas (ex.: pro).'}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
            <Input label="Nome" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input
              label="Preço mensal (centavos)"
              type="number"
              inputMode="numeric"
              min={0}
              className="font-mono tabular-nums"
              value={draft.priceMonthlyCents ?? 0}
              hint={`= ${money(draft.priceMonthlyCents)}`}
              onChange={(e) => setDraft({ ...draft, priceMonthlyCents: Number(e.target.value) })}
            />
            <Input
              label="Preço anual (centavos)"
              type="number"
              inputMode="numeric"
              min={0}
              className="font-mono tabular-nums"
              value={draft.priceYearlyCents ?? 0}
              hint={`= ${money(draft.priceYearlyCents)}`}
              onChange={(e) => setDraft({ ...draft, priceYearlyCents: Number(e.target.value) })}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="plan-limits">
          <h3 id="plan-limits" className={eyebrowClass}>
            Limites
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {LIMIT_KEYS.map((k) => (
              <Input
                key={k}
                label={LIMIT_LABEL[k]}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="Sem limite"
                className="font-mono tabular-nums"
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
              />
            ))}
          </div>
        </section>

        <fieldset className="flex flex-col gap-3">
          <legend className={cn(eyebrowClass, 'mb-3')}>Features</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {FEATURE_KEYS.map((k) => (
              <label
                key={k}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 font-body text-sm text-text transition-colors duration-(--dur-fast) hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={Boolean(draft.features?.[k])}
                  onChange={(e) => setDraft({ ...draft, features: { ...draft.features, [k]: e.target.checked } })}
                  className={checkboxClass}
                />
                {FEATURE_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Drawer>
  );
}

function PlanCard({
  plan,
  onEdit,
  onDeactivate,
  deactivating,
}: {
  plan: Plan;
  onEdit: () => void;
  onDeactivate: () => void;
  deactivating: boolean;
}) {
  const limits = Object.entries(plan.limits) as [LimitKey, number][];
  const features = (Object.entries(plan.features) as [FeatureKey, boolean][]).filter(([, v]) => v);
  return (
    <article
      aria-labelledby={`plan-${plan.id}`}
      className={cn(
        'flex flex-col rounded-lg border bg-surface',
        plan.isActive ? 'border-border' : 'border-dashed border-border-2',
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={`plan-${plan.id}`} className="truncate font-head text-lg font-semibold tracking-[-0.02em] text-text">
            {plan.name}
          </h2>
          <p className="truncate font-mono text-xs text-text-low">{plan.key}</p>
        </div>
        {!plan.isActive && <Badge size="sm">Inativo</Badge>}
      </header>

      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-2xl font-medium tabular-nums tracking-[-0.02em] text-text">
            {money(plan.priceMonthlyCents)}
          </span>
          <span className="font-body text-sm text-text-low">/mês</span>
          {plan.priceYearlyCents > 0 && (
            <span className="font-body text-sm text-text-low">
              · <span className="font-mono tabular-nums text-text-mid">{money(plan.priceYearlyCents)}</span>/ano
            </span>
          )}
        </p>

        {limits.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {limits.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
                <dt className="truncate font-body text-sm text-text-low">{LIMIT_LABEL[k] ?? k}</dt>
                <dd className="font-mono text-sm tabular-nums text-text">{formatNumber(v)}</dd>
              </div>
            ))}
          </dl>
        )}

        {features.length > 0 && (
          <ul aria-label="Features incluídas" className="flex flex-wrap gap-1.5">
            {features.map(([k]) => (
              <li key={k}>
                <Badge size="sm">
                  <Check className="size-3 text-success" aria-hidden />
                  {FEATURE_LABEL[k] ?? k}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="mt-auto flex items-center gap-2 border-t border-border px-5 py-3">
        <Button
          variant="secondary"
          size="sm"
          className="max-md:h-11"
          leftIcon={<Pencil className="size-4" aria-hidden />}
          aria-label={`Editar o plano ${plan.name}`}
          onClick={onEdit}
        >
          Editar
        </Button>
        {plan.isActive && (
          <Button
            variant="ghost"
            size="sm"
            className="hover:text-danger max-md:h-11"
            loading={deactivating}
            leftIcon={<Power className="size-4" aria-hidden />}
            aria-label={`Desativar o plano ${plan.name}`}
            onClick={onDeactivate}
          >
            Desativar
          </Button>
        )}
      </footer>
    </article>
  );
}

export function PlansCatalog() {
  const query = usePlans();
  const deactivate = useDeactivatePlan();
  const { toast } = useToast();
  // `null` = fechado; `'new'` = criar; Plan = editar.
  const [editor, setEditor] = useState<Plan | 'new' | null>(null);
  const plans = query.data?.plans ?? [];
  const activeCount = plans.filter((p) => p.isActive).length;

  async function onDeactivate(plan: Plan) {
    const msg = `Desativar o plano "${plan.name}"? Assinaturas existentes não mudam, mas ele sai do catálogo.`;
    if (!window.confirm(msg)) return;
    try {
      await deactivate.mutateAsync(plan.id);
      toast({ variant: 'success', title: 'Plano desativado', description: plan.name });
    } catch {
      toast({ variant: 'error', title: 'Não foi possível desativar o plano', description: 'Tente novamente.' });
    }
  }

  const createButton = (
    <Button variant="primary" leftIcon={<Plus className="size-4" aria-hidden />} onClick={() => setEditor('new')}>
      Novo plano
    </Button>
  );

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/plans"
        title="Planos"
        description={
          query.data ? (
            <span>
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(plans.length)}</span> no catálogo ·{' '}
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(activeCount)}</span>{' '}
              {activeCount === 1 ? 'ativo' : 'ativos'}
            </span>
          ) : (
            'Catálogo comercial com limites e features tipados.'
          )
        }
        actions={createButton}
      />

      {query.isLoading ? (
        <div role="status" aria-busy="true" aria-label="Carregando planos" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-lg" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Não foi possível carregar os planos"
          reason="O catálogo de planos não respondeu."
          whatToDo="Verifique a conexão e tente novamente."
          action={
            <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nenhum plano ainda"
          description="Crie o primeiro plano com seus limites e features."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              onEdit={() => setEditor(p)}
              onDeactivate={() => void onDeactivate(p)}
              deactivating={deactivate.isPending && deactivate.variables === p.id}
            />
          ))}
        </div>
      )}

      {editor !== null && (
        <PlanEditor
          key={editor === 'new' ? 'new' : editor.id}
          open
          initial={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
