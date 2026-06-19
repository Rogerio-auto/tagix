'use client';

/**
 * Workspace 360 (F26-S07) — hub de UM tenant: resumo+plano, uso/custo, membros, canais,
 * agentes, saude e audit recente; com links para assinatura (S08), playground (S10) e
 * view-as (S09). Consome F26-S02. NENHUM secret e exibido (so metadados). DS v2 dark-first.
 */
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Bot,
  CreditCard,
  Eye,
  Radio,
  Users,
} from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';
import { BillingCheckoutPanel } from './BillingCheckoutPanel';
import { useWorkspace360 } from './queries';

function Card({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-high">
          <span className="text-text-mid">{icon}</span>
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function Workspace360({ id }: { id: string }) {
  const { data, isLoading } = useWorkspace360(id);

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const { summary, usage, members, channels, agents, health, recentAudit } = data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/platform/tenants" className="text-xs text-text-low hover:text-accent">
            ← Tenants
          </Link>
          <h1 className="text-2xl font-semibold text-text-high">{summary.name}</h1>
          <p className="text-sm text-text-mid">
            {summary.slug} · criado em {fmtDate(summary.createdAt)}
            {summary.owner ? ` · owner ${summary.owner.email}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/platform/subscriptions?workspace=${summary.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-high hover:border-accent"
          >
            <CreditCard className="size-4" aria-hidden /> Assinatura
          </Link>
          <Link
            href={`/platform/playground?workspace=${summary.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-high hover:border-accent"
          >
            <Bot className="size-4" aria-hidden /> Playground
          </Link>
          <Link
            href={`/platform/impersonation?workspace=${summary.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-surface-0 hover:opacity-90"
          >
            <Eye className="size-4" aria-hidden /> Ver como
          </Link>
        </div>
      </header>

      {(health.capExceeded || health.trialExpired || health.failedWebhookDeliveries > 0) && (
        <div className="flex flex-col gap-1 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" aria-hidden /> Sinais de risco
          </span>
          <ul className="ml-6 list-disc text-text-mid">
            {health.capExceeded && <li>Custo mensal estourou o teto da policy.</li>}
            {health.trialExpired && <li>Trial vencido.</li>}
            {health.failedWebhookDeliveries > 0 && (
              <li>{health.failedWebhookDeliveries} entrega(s) de webhook com falha.</li>
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Resumo & plano" icon={<CreditCard className="size-4" />}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-text-low">Plano</dt>
            <dd className="text-text-high">{summary.planName ?? '—'}</dd>
            <dt className="text-text-low">Status</dt>
            <dd className="text-text-high">{summary.subscriptionStatus}</dd>
            <dt className="text-text-low">Trial até</dt>
            <dd className="text-text-high">{fmtDate(summary.trialEndsAt)}</dd>
            <dt className="text-text-low">Setor</dt>
            <dd className="text-text-high">{summary.industry ?? '—'}</dd>
          </dl>
          <BillingCheckoutPanel workspaceId={summary.id} currentPlanId={null} />
        </Card>

        <Card
          title="Uso & custo (mês)"
          icon={<Activity className="size-4" />}
          action={<span className="text-xs text-text-low">exclui testes</span>}
        >
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-semibold text-text-high">
                ${usage.monthCostUsd.toFixed(2)}
              </div>
              <div className="text-xs text-text-low">{usage.monthTokens.toLocaleString('pt-BR')} tokens</div>
            </div>
            {usage.capUsd != null && (
              <div className="text-right text-xs text-text-mid">
                teto ${usage.capUsd.toFixed(2)}
                {usage.pctOfCap != null && (
                  <div className={usage.pctOfCap >= 1 ? 'text-danger' : 'text-text-low'}>
                    {Math.round(usage.pctOfCap * 100)}% do teto
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`Membros (${members.length})`} icon={<Users className="size-4" />}>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {members.length === 0 && <li className="py-2 text-text-low">Nenhum membro.</li>}
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2">
                <span className="flex flex-col">
                  <span className="text-text-high">{m.name ?? m.email}</span>
                  <span className="text-xs text-text-low">{m.email}</span>
                </span>
                <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-text-mid">{m.role}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Canais (${channels.length})`} icon={<Radio className="size-4" />}>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {channels.length === 0 && <li className="py-2 text-text-low">Nenhum canal.</li>}
            {channels.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="flex flex-col">
                  <span className="text-text-high">{c.name}</span>
                  <span className="text-xs text-text-low">{c.provider}</span>
                </span>
                <span className={`text-xs ${c.isActive ? 'text-ok' : 'text-text-low'}`}>
                  {c.isActive ? 'ativo' : 'inativo'}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Agentes (${agents.length})`} icon={<Bot className="size-4" />}>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {agents.length === 0 && <li className="py-2 text-text-low">Nenhum agente.</li>}
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span className="flex flex-col">
                  <span className="text-text-high">{a.name}</span>
                  <span className="text-xs text-text-low font-mono">{a.model}</span>
                </span>
                <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-text-mid">{a.status}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Saúde" icon={<Activity className="size-4" />}>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-text-low">Conversas abertas</dt>
            <dd className="text-text-high">{health.openConversations}</dd>
            <dt className="text-text-low">Deals abertos</dt>
            <dd className="text-text-high">{health.openDeals}</dd>
            <dt className="text-text-low">Webhooks com falha</dt>
            <dd className={health.failedWebhookDeliveries > 0 ? 'text-warn' : 'text-text-high'}>
              {health.failedWebhookDeliveries}
            </dd>
          </dl>
        </Card>
      </div>

      <Card title="Auditoria recente" icon={<Activity className="size-4" />}>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {recentAudit.length === 0 && <li className="py-2 text-text-low">Sem eventos recentes.</li>}
          {recentAudit.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2">
              <span className="text-text-high">
                {e.action} <span className="text-text-low">· {e.resourceType}</span>
              </span>
              <span className="text-xs text-text-low">
                {e.actorType} · {new Date(e.createdAt).toLocaleString('pt-BR')}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
