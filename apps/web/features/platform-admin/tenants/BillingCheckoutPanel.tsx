'use client';

/**
 * Cobrança assistida (F41-S08, PAYMENTS_ABACATEPAY.md §7) — ação contextual no
 * Workspace 360: o super-admin escolhe plano/ciclo/método, gera um link de
 * checkout real (POST /billing/checkout, F41-S07) e copia/abre o link.
 *
 * Inline expand-in-place (não full-screen modal, UX §2.3) coerente com o resto
 * do platform-admin. DS v2 dark-first, zero hex hardcoded. Quem transiciona o
 * status do tenant é sempre o webhook HMAC — aqui só geramos o link.
 */
import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, ReceiptText, X } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import {
  type BillingCycle,
  type BillingMethod,
  type CheckoutErrorCode,
  type CheckoutResult,
  useBillingPlans,
  useGenerateCheckout,
} from './queries';

const CYCLES: readonly { value: BillingCycle; label: string }[] = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'yearly', label: 'Anual' },
];

const METHODS: readonly { value: BillingMethod; label: string }[] = [
  { value: 'card', label: 'Cartão' },
  { value: 'pix', label: 'PIX' },
];

/** Mensagens claras por código de erro de domínio (UX §3 — feedback acionável). */
const ERROR_COPY: Record<CheckoutErrorCode, { title: string; description: string }> = {
  no_billing_contact: {
    title: 'Tenant sem contato de cobrança',
    description:
      'Nenhum membro ativo do tenant tem e-mail. Cadastre um OWNER com e-mail antes de gerar a cobrança.',
  },
  plan_not_billable: {
    title: 'Plano sem preço para o ciclo',
    description: 'Esse plano não tem valor configurado para o ciclo escolhido. Ajuste o catálogo de planos.',
  },
  plan_not_found: {
    title: 'Plano indisponível',
    description: 'O plano selecionado não existe ou está inativo. Escolha outro plano.',
  },
  workspace_not_found: {
    title: 'Tenant não encontrado',
    description: 'Não foi possível localizar este tenant. Recarregue a página.',
  },
  invalid_body: {
    title: 'Dados inválidos',
    description: 'Revise plano, ciclo e método e tente novamente.',
  },
  unknown: {
    title: 'Falha ao gerar a cobrança',
    description: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
  },
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtCents(cents: number): string {
  return BRL.format(cents / 100);
}

/** Estilo compartilhado dos <select> (espelha o padrão do platform-admin). */
const selectClass =
  'rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-high focus:border-accent focus:outline-none focus-visible:shadow-glow-md';

function GeneratedLink({ result, onReset }: { result: CheckoutResult; onReset: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.redirectUrl);
      setCopied(true);
      toast({ variant: 'success', title: 'Link copiado', description: 'Cole no canal de atendimento do tenant.' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: 'error', title: 'Não foi possível copiar', description: 'Copie o link manualmente.' });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ok/40 bg-ok/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text-high">
        <Check className="size-4 text-ok" aria-hidden />
        Link de cobrança gerado
      </div>
      <p className="text-xs text-text-mid">
        {fmtCents(result.amountCents)} · {result.cycle === 'yearly' ? 'anual' : 'mensal'} ·{' '}
        {result.method === 'pix' ? 'PIX' : 'cartão'}
      </p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
        <Link2 className="size-4 shrink-0 text-text-low" aria-hidden />
        <span className="truncate font-mono text-xs text-text-mid" title={result.redirectUrl}>
          {result.redirectUrl}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={copy}
          leftIcon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        >
          {copied ? 'Copiado' : 'Copiar link'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          leftIcon={<ExternalLink className="size-4" />}
          onClick={() => window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')}
        >
          Abrir checkout
        </Button>
        <button
          type="button"
          onClick={onReset}
          className="ml-auto rounded-md px-2 py-1 text-xs text-text-low outline-none hover:text-text-high focus-visible:shadow-glow-md"
        >
          Gerar outro
        </button>
      </div>
    </div>
  );
}

export function BillingCheckoutPanel({
  workspaceId,
  currentPlanId,
}: {
  workspaceId: string;
  currentPlanId: string | null;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data: plansData, isLoading: plansLoading, isError: plansError } = useBillingPlans();
  const generate = useGenerateCheckout(workspaceId);

  const plans = useMemo(
    () =>
      (plansData?.plans ?? [])
        .filter((p) => p.isActive || p.id === currentPlanId)
        .slice()
        .sort((a, b) => a.position - b.position),
    [plansData, currentPlanId],
  );

  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [method, setMethod] = useState<BillingMethod>('pix');

  const effectivePlanId = planId || currentPlanId || plans[0]?.id || '';
  const selectedPlan = plans.find((p) => p.id === effectivePlanId);
  const previewCents = selectedPlan
    ? cycle === 'yearly'
      ? selectedPlan.priceYearlyCents > 0
        ? selectedPlan.priceYearlyCents
        : selectedPlan.priceMonthlyCents * 12
      : selectedPlan.priceMonthlyCents
    : null;

  async function onGenerate() {
    if (!effectivePlanId) return;
    try {
      await generate.mutateAsync({ planId: effectivePlanId, cycle, method });
      toast({
        variant: 'success',
        title: 'Cobrança gerada',
        description: 'O link de checkout está pronto para ser enviado ao tenant.',
      });
    } catch (err) {
      const code: CheckoutErrorCode = err && typeof err === 'object' && 'code' in err
        ? ((err as { code: CheckoutErrorCode }).code)
        : 'unknown';
      const copy = ERROR_COPY[code];
      toast({ variant: 'error', title: copy.title, description: copy.description });
    }
  }

  if (!open) {
    return (
      <div className="mt-1 border-t border-border pt-3">
        <Button
          size="sm"
          variant="outline"
          leftIcon={<ReceiptText className="size-4" />}
          onClick={() => setOpen(true)}
        >
          Gerar cobrança
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-high">
          <ReceiptText className="size-4 text-text-mid" aria-hidden />
          Gerar cobrança
        </h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            generate.reset();
          }}
          aria-label="Fechar"
          className="rounded-md p-1 text-text-low outline-none hover:text-text-high focus-visible:shadow-glow-md"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {generate.isSuccess && generate.data ? (
        <GeneratedLink result={generate.data} onReset={() => generate.reset()} />
      ) : (
        <>
          {plansError ? (
            <p className="text-sm text-danger">Não foi possível carregar os planos. Recarregue a página.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm sm:col-span-3">
                  <span className="text-text-mid">Plano</span>
                  <select
                    value={effectivePlanId}
                    onChange={(e) => setPlanId(e.target.value)}
                    disabled={plansLoading || plans.length === 0}
                    className={selectClass}
                  >
                    {plans.length === 0 && <option value="">{plansLoading ? 'Carregando…' : 'Nenhum plano ativo'}</option>}
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-mid">Ciclo</span>
                  <select
                    value={cycle}
                    onChange={(e) => setCycle(e.target.value as BillingCycle)}
                    className={selectClass}
                  >
                    {CYCLES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-mid">Método</span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as BillingMethod)}
                    className={selectClass}
                  >
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-col justify-end gap-1 text-sm">
                  <span className="text-text-mid">Valor</span>
                  <span className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-text-high">
                    {previewCents != null ? fmtCents(previewCents) : '—'}
                  </span>
                </div>
              </div>

              <p className="text-xs text-text-low">
                Gera um link de checkout real. O acesso do tenant só muda quando o pagamento for confirmado.
              </p>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  loading={generate.isPending}
                  disabled={!effectivePlanId}
                  onClick={onGenerate}
                  leftIcon={<Link2 className="size-4" />}
                >
                  {generate.isPending ? 'Gerando…' : 'Gerar link'}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
