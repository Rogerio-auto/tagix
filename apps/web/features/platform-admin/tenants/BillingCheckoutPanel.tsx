'use client';

/**
 * Cobrança assistida (F41-S08, PAYMENTS_ABACATEPAY.md §7) — ação contextual no
 * Workspace 360: o super-admin escolhe plano/ciclo/método, gera um link de
 * checkout real (POST /billing/checkout, F41-S07) e copia/abre o link.
 *
 * Inline expand-in-place (não full-screen modal, UX §2.3) coerente com o resto
 * do platform-admin. DS 3.0 (F72-S08): controles no desenho do `Input`, valor em mono,
 * moeda pelo `shared/lib/locale` (sem locale literal). Quem transiciona o status do
 * tenant é sempre o webhook HMAC — aqui só geramos o link (fluxo inalterado).
 */
import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, ReceiptText, X } from 'lucide-react';
import { Button, IconButton, useToast } from '@hm/ui';
import { formatMoney } from '@/shared/lib/locale';
import { controlClass, FieldLabel } from '../ui/kit';
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

/** O catálogo de planos é cobrado em real (AbacatePay, PAYMENTS_ABACATEPAY.md). */
const PLAN_CURRENCY = 'BRL';

function fmtCents(cents: number): string {
  return formatMoney(cents, PLAN_CURRENCY);
}

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
    <div role="status" className="flex flex-col gap-3 rounded-md border border-success/30 bg-success/10 p-4">
      <div className="flex items-center gap-2 font-body text-sm font-bold text-text">
        <Check className="size-4 text-success" aria-hidden />
        Link de cobrança gerado
      </div>
      <p className="font-body text-sm text-text-mid">
        <span className="font-mono tabular-nums text-text">{fmtCents(result.amountCents)}</span> ·{' '}
        {result.cycle === 'yearly' ? 'anual' : 'mensal'} · {result.method === 'pix' ? 'PIX' : 'cartão'}
      </p>
      <div className="flex min-w-0 items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2">
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
          leftIcon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        >
          {copied ? 'Copiado' : 'Copiar link'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          leftIcon={<ExternalLink className="size-4" aria-hidden />}
          onClick={() => window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')}
        >
          Abrir checkout
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onReset}>
          Gerar outro
        </Button>
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
      <div className="mt-4 border-t border-border pt-4">
        <Button
          size="sm"
          variant="outline"
          leftIcon={<ReceiptText className="size-4" aria-hidden />}
          onClick={() => setOpen(true)}
        >
          Gerar cobrança
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-md border border-border bg-surface-inset p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-head text-sm font-semibold text-text">
          <ReceiptText className="size-4 text-text-low" aria-hidden />
          Gerar cobrança
        </h3>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Fechar a cobrança"
          icon={<X aria-hidden />}
          onClick={() => {
            setOpen(false);
            generate.reset();
          }}
        />
      </div>

      {generate.isSuccess && generate.data ? (
        <GeneratedLink result={generate.data} onReset={() => generate.reset()} />
      ) : plansError ? (
        <p role="alert" className="font-body text-sm text-danger">
          Não foi possível carregar os planos. Recarregue a página.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FieldLabel label="Plano" className="col-span-2">
              <select
                value={effectivePlanId}
                onChange={(e) => setPlanId(e.target.value)}
                disabled={plansLoading || plans.length === 0}
                className={controlClass}
              >
                {plans.length === 0 && <option value="">{plansLoading ? 'Carregando…' : 'Nenhum plano ativo'}</option>}
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Ciclo">
              <select
                value={cycle}
                onChange={(e) => setCycle(e.target.value as BillingCycle)}
                className={controlClass}
              >
                {CYCLES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Método">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as BillingMethod)}
                className={controlClass}
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </div>

          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <span className="font-body text-sm text-text-low">Valor</span>
            <span className="font-mono text-xl tabular-nums text-text" aria-live="polite">
              {previewCents != null ? fmtCents(previewCents) : '—'}
            </span>
          </div>

          <p className="font-body text-sm text-text-low">
            Gera um link de checkout real. O acesso do tenant só muda quando o pagamento for confirmado.
          </p>

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              loading={generate.isPending}
              disabled={!effectivePlanId}
              onClick={onGenerate}
              leftIcon={<Link2 className="size-4" aria-hidden />}
            >
              {generate.isPending ? 'Gerando…' : 'Gerar link'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
