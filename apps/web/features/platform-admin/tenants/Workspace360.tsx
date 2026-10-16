'use client';

/**
 * Workspace 360 (F26-S07) no DS 3.0 (F72-S08) — o hub de UM tenant para quem opera a
 * plataforma: quem é, quanto custa, quem usa, o que está ligado e o que mudou.
 *
 * Hierarquia: identidade (nome, status, plano, slug) → atalhos de ação (assinatura,
 * playground, ver como) → sinais de risco (só quando existem) → KPIs em mono (custo de IA
 * com o teto, tokens, conversas e deals abertos) → pessoas, agentes e canais à esquerda;
 * assinatura + cobrança e saúde à direita → auditoria recente.
 *
 * NENHUM segredo é exibido (só metadados). O custo de IA é legítimo aqui (DS3_ADOCAO §2.7).
 * Os atalhos só navegam: "Ver como" leva à tela de view-as, que pede motivo e audita.
 *
 * UX: §2.5 `?` no título; §2.6 vazios por seção; §2.7 skeleton no formato da tela;
 * §2.11 erro em 3 partes (404 vira "tenant não encontrado" com volta à lista).
 */
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  CreditCard,
  Eye,
  FileClock,
  Gauge,
  HeartPulse,
  MessagesSquare,
  Radio,
  Target,
  Users,
} from 'lucide-react';
import { Badge, Button, ErrorState, Skeleton } from '@hm/ui';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { HelpPanel } from '@/shared/components/help';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/shared/lib/locale';
import { agentStatus, capTone, initials, memberRole, usd } from '../lib/labels';
import { Count, Facts, Kpi, Panel, SubscriptionBadge } from '../ui/kit';
import { BillingCheckoutPanel } from './BillingCheckoutPanel';
import { useWorkspace360, type Workspace360 as Workspace360Data } from './queries';

const DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const shortcutClass =
  'inline-flex h-10 items-center gap-2 rounded-sm border px-4 font-body text-sm font-bold outline-none ' +
  'transition-[color,background-color,border-color,transform] duration-(--dur-base) ease-ds focus-visible:focus-ring ' +
  'motion-safe:hover:-translate-y-px max-md:h-11';

function BackLink() {
  return (
    <Link
      href="/platform/tenants"
      className="inline-flex items-center gap-1.5 rounded-xs font-body text-sm text-text-low outline-none transition-colors duration-(--dur-fast) hover:text-text focus-visible:focus-ring"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Tenants
    </Link>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Carregando o 360 do tenant" className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-lg" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg lg:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}

function EmptyRow({ children }: { children: string }) {
  return <li className="px-5 py-6 text-center font-body text-sm text-text-low">{children}</li>;
}

export function Workspace360({ id }: { id: string }) {
  const query = useWorkspace360(id);

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Loading />
      </div>
    );
  }

  if (query.isError || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <PageHeader title={notFound ? 'Tenant não encontrado' : 'Workspace 360'} />
        <ErrorState
          title={notFound ? 'Este tenant não existe mais' : 'Não foi possível carregar o 360'}
          reason={
            notFound
              ? 'O workspace foi removido ou o endereço está incompleto.'
              : 'O resumo do tenant não respondeu.'
          }
          whatToDo={notFound ? 'Volte à lista e abra o tenant de novo.' : 'Verifique a conexão e tente novamente.'}
          reference={query.error instanceof ApiError ? query.error.ref : undefined}
          action={
            notFound ? undefined : (
              <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
                Tentar de novo
              </Button>
            )
          }
        />
      </div>
    );
  }

  return <Loaded data={query.data} />;
}

function Loaded({ data }: { data: Workspace360Data }) {
  const { summary, usage, members, channels, agents, health, recentAudit } = data;
  const cap = capTone(usage.pctOfCap);
  const risks: string[] = [];
  if (health.capExceeded) risks.push('O custo de IA do mês passou do teto da política.');
  if (health.trialExpired) risks.push('O período de teste venceu.');
  if (health.failedWebhookDeliveries > 0) {
    risks.push(
      `${formatNumber(health.failedWebhookDeliveries)} ${
        health.failedWebhookDeliveries === 1 ? 'entrega de webhook falhou' : 'entregas de webhook falharam'
      }.`,
    );
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div className="flex flex-col gap-4">
        <BackLink />

        {/* Identidade + atalhos */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-lg border border-border-2 bg-surface-2 font-head text-lg font-semibold tracking-[-0.02em] text-text md:size-14 md:text-xl"
            >
              {initials(summary.name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words font-head text-h4 text-text md:text-h3">{summary.name}</h1>
                <HelpPanel title="Workspace 360">
                  <div className="space-y-3 font-body text-sm text-text-mid">
                    <p>
                      Tudo de um tenant numa tela: assinatura e cobrança, custo de IA do mês contra o teto da
                      política, membros, agentes, canais, saúde e os últimos eventos de auditoria.
                    </p>
                    <p>
                      O custo exclui execuções de teste (Playground). Nenhum segredo do tenant aparece aqui.
                    </p>
                    <p>
                      &ldquo;Ver como&rdquo; abre uma sessão somente leitura, com motivo obrigatório, prazo e
                      registro em auditoria.
                    </p>
                  </div>
                </HelpPanel>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-body text-sm text-text-low">
                <SubscriptionBadge status={summary.subscriptionStatus} size="sm" />
                <span className="font-semibold text-text-mid">{summary.planName ?? 'Sem plano'}</span>
                <span className="font-mono text-text-mid">{summary.slug}</span>
                <span className="whitespace-nowrap">
                  desde <span className="font-mono tabular-nums text-text-mid">{formatDate(summary.createdAt, DATE)}</span>
                </span>
              </p>
            </div>
          </div>

          <nav aria-label="Ações do tenant" className="flex flex-wrap gap-2">
            <Link
              href={`/platform/subscriptions?workspace=${encodeURIComponent(summary.id)}`}
              className={cn(shortcutClass, 'border-border bg-surface-2 text-text hover:border-border-2 hover:bg-surface-3')}
            >
              <CreditCard className="size-4" aria-hidden /> Assinatura
            </Link>
            <Link
              href={`/platform/playground?workspace=${encodeURIComponent(summary.id)}`}
              className={cn(shortcutClass, 'border-border bg-surface-2 text-text hover:border-border-2 hover:bg-surface-3')}
            >
              <Bot className="size-4" aria-hidden /> Playground
            </Link>
            <Link
              href={`/platform/impersonation?workspace=${encodeURIComponent(summary.id)}`}
              className={cn(shortcutClass, 'border-warn/30 bg-warn/10 text-warn hover:border-warn/50 hover:bg-warn/15')}
            >
              <Eye className="size-4" aria-hidden /> Ver como
            </Link>
          </nav>
        </div>
      </div>

      {risks.length > 0 && (
        <section
          aria-labelledby="w360-risks"
          className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 px-5 py-4"
        >
          <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <h2 id="w360-risks" className="font-head text-sm font-semibold text-text">
              Sinais de risco
            </h2>
            <ul className="mt-1 flex flex-col gap-0.5 font-body text-sm text-text-mid">
              {risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* KPIs */}
      <section aria-label="Números do mês" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Rótulos curtos (o "do mês" vai para a dica): a 375, em duas colunas, rótulo de
            duas linhas desalinhava os valores da mesma fileira. */}
        <Kpi
          label="Custo de IA"
          icon={Gauge}
          value={usd(usage.monthCostUsd)}
          tone={cap === 'over' ? 'danger' : cap === 'warn' ? 'warn' : 'default'}
          meter={usage.capUsd != null ? usage.pctOfCap : null}
          hint={
            usage.capUsd != null ? (
              <>
                <span className="font-mono tabular-nums text-text-mid">{formatPercent(usage.pctOfCap)}</span> de{' '}
                <span className="font-mono tabular-nums text-text-mid">{usd(usage.capUsd)}</span> no mês
              </>
            ) : (
              'No mês, sem teto na política'
            )
          }
        />
        <Kpi
          label="Tokens"
          icon={Activity}
          value={formatNumber(usage.monthTokens)}
          hint="No mês, sem testes"
        />
        <Kpi
          label="Conversas"
          icon={MessagesSquare}
          value={formatNumber(health.openConversations)}
          hint="Abertas agora"
        />
        <Kpi label="Deals" icon={Target} value={formatNumber(health.openDeals)} hint="Abertos no funil" />
      </section>

      {/* Colunas alinhadas pelo topo: nenhum card estica além do próprio conteúdo
          (card com lista curta esticado parece lista que não carregou). Auditoria fica na
          coluna larga para que o vão que sobra caia no fim da coluna lateral, não no meio
          da página. */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Panel
            title="Membros"
            titleId="w360-members"
            icon={Users}
            body="flush"
            action={<Count value={formatNumber(members.length)} label={`${members.length} membros`} />}
          >
            <ul className="divide-y divide-border">
              {members.length === 0 && <EmptyRow>Nenhum membro.</EmptyRow>}
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-pill bg-surface-3 font-head text-xs font-semibold text-text-mid"
                    >
                      {initials(m.name ?? m.email)}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-body text-sm font-semibold text-text">{m.name ?? m.email}</span>
                      <span className="truncate font-mono text-xs text-text-low">{m.email}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {m.lastSeenAt ? (
                      <span className="hidden whitespace-nowrap font-mono text-xs tabular-nums text-text-low sm:inline">
                        {formatDate(m.lastSeenAt, DATE)}
                      </span>
                    ) : (
                      <span className="hidden whitespace-nowrap font-body text-xs text-text-low sm:inline">
                        Nunca entrou
                      </span>
                    )}
                    <Badge size="sm">{memberRole(m.role)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="grid items-start gap-4 md:grid-cols-2">
            <Panel
              title="Agentes"
              titleId="w360-agents"
              icon={Bot}
              body="flush"
              action={<Count value={formatNumber(agents.length)} label={`${agents.length} agentes`} />}
            >
              <ul className="divide-y divide-border">
                {agents.length === 0 && <EmptyRow>Nenhum agente.</EmptyRow>}
                {agents.map((a) => {
                  const s = agentStatus(a.status);
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-body text-sm font-semibold text-text">{a.name}</span>
                        <span className="truncate font-mono text-xs text-text-low">{a.model}</span>
                      </span>
                      <Badge tone={s.tone} size="sm" dot>
                        {s.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel
              title="Canais"
              titleId="w360-channels"
              icon={Radio}
              body="flush"
              action={<Count value={formatNumber(channels.length)} label={`${channels.length} canais`} />}
            >
              <ul className="divide-y divide-border">
                {channels.length === 0 && <EmptyRow>Nenhum canal.</EmptyRow>}
                {channels.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-body text-sm font-semibold text-text">{c.name}</span>
                      <span className="truncate font-mono text-xs text-text-low">{c.provider}</span>
                    </span>
                    <Badge tone={c.isActive ? 'success' : 'neutral'} size="sm" dot>
                      {c.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel
            title="Auditoria recente"
            titleId="w360-audit"
            icon={FileClock}
            body="flush"
            action={<Count value={formatNumber(recentAudit.length)} label={`${recentAudit.length} eventos`} />}
          >
            <ol className="divide-y divide-border">
              {recentAudit.length === 0 && <EmptyRow>Sem eventos recentes.</EmptyRow>}
              {recentAudit.map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[10.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                >
                  <time
                    dateTime={e.createdAt}
                    className="whitespace-nowrap font-mono text-xs tabular-nums text-text-low"
                  >
                    {formatDateTime(e.createdAt, DATE_TIME)}
                  </time>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-mono text-sm text-text">{e.action}</span>
                    <span className="truncate font-body text-sm text-text-low">{e.resourceType}</span>
                  </span>
                  <span className="justify-self-start sm:justify-self-end">
                    <Badge size="sm">{e.actorType}</Badge>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Assinatura" titleId="w360-subscription" icon={CreditCard}>
            <Facts
              items={[
                { term: 'Plano', value: summary.planName ?? 'Sem plano' },
                { term: 'Status', value: <SubscriptionBadge status={summary.subscriptionStatus} size="sm" /> },
                {
                  term: 'Teste até',
                  value: summary.trialEndsAt ? formatDate(summary.trialEndsAt, DATE) : '—',
                  mono: true,
                },
                { term: 'Setor', value: summary.industry ?? '—' },
                { term: 'Proprietário', value: summary.owner?.email ?? '—', mono: true },
              ]}
            />
            <BillingCheckoutPanel workspaceId={summary.id} currentPlanId={null} />
          </Panel>

          <Panel
            title="Saúde"
            titleId="w360-health"
            icon={HeartPulse}
            tone={health.failedWebhookDeliveries > 0 || health.capExceeded ? 'warn' : 'default'}
          >
            <Facts
              items={[
                {
                  term: 'Webhooks com falha',
                  value: (
                    <span className={health.failedWebhookDeliveries > 0 ? 'text-warn' : undefined}>
                      {formatNumber(health.failedWebhookDeliveries)}
                    </span>
                  ),
                  mono: true,
                },
                {
                  term: 'Teto de custo',
                  value: health.capExceeded ? (
                    <span className="text-danger">Estourado</span>
                  ) : usage.capUsd != null ? (
                    'Dentro'
                  ) : (
                    'Sem teto'
                  ),
                },
                { term: 'Teste', value: health.trialExpired ? <span className="text-warn">Vencido</span> : 'Em dia' },
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
