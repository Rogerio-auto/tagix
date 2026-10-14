'use client';

/**
 * Home do DS 3.0 (F72-S04). Substitui o dashboard de cards e a tela Hoje por uma
 * única página que responde, nesta ordem:
 *
 *   1. o que mudou (saudação + manchete contra a janela anterior do mesmo tamanho);
 *   2. resultado (receita, leads, speed-to-lead, conversões, com delta), em mono;
 *   3. o que precisa de você agora (com ação em cada linha);
 *   4. quem está esperando + agenda do dia (a antiga tela Hoje);
 *   5. o painel completo, com o layout pessoal (F8) de sempre.
 *
 * O servidor decide o que cada papel recebe (`/api/dashboard/home` e `/today`): a
 * tela não tem `if (role)` para dado. Quem não pode agir sobre custo de IA ou de infra
 * não o recebe, e a Home não o pede. (O único `can()` daqui escolhe o verbo do convite
 * de empresa nova: conectar canal só para quem pode.)
 *
 * UX aplicada (UX_PRINCIPLES §2/§3): §2.1 clique no corpo (KPI, linha de atenção,
 * lead); §2.3 detalhe em Drawer (painel completo); §2.5 `?` de ajuda; §2.6 vazio com
 * CTA ligado ao checklist da F43; §2.7 skeleton com a forma real, troca de janela sem
 * piscar e botão `loading`; §2.9 "Perdido" atrás de confirmação; §2.10 setas no
 * seletor de janela e no gráfico; §2.11 erro em 3 partes; §3 mobile: resultado no
 * topo, depois atenção.
 */
import type * as React from 'react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Rocket } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, EmptyState, ErrorState, Skeleton, StatusPill } from '@hm/ui';
import { HelpHint } from '@/shared/components/help';
import { InstallPrompt, PushToggle } from '@/shared/pwa';
import { useAuthStore } from '@/shared/stores/auth.store';
import { SetupChecklist } from '@/features/onboarding/checklist';
import { TodayAgenda, WaitingQueue, useToday } from '@/features/today';
import { CustomizeDashboardButton } from '../customization';
import { DashboardPanels } from '../DashboardPanels';
import { useDashboard } from '../queries';
import { AttentionList, buildAttentionRows } from './AttentionList';
import {
  buildHeadline,
  comparisonLabel,
  firstName,
  greetingForHour,
  isHomeEmpty,
  periodFromPreference,
} from './home-format';
import { Journey } from './Journey';
import { KpiStrip } from './KpiStrip';
import { Panel } from './Panel';
import { PeriodSwitch } from './PeriodSwitch';
import { useHome } from './queries';
import { ReservedSlots } from './ReservedSlots';
import { RevenueChart } from './RevenueChart';
import type { HomePeriodDays } from './types';
import { useHomeSocket } from './useHomeSocket';

function HomeSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label="Carregando a Home">
      {/* Mesma forma da faixa real (manchete em linha inteira + três no celular). */}
      <div className="@container">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border @3xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`flex flex-col gap-3 bg-surface p-3 @3xl:gap-4 @3xl:p-6 ${i === 0 ? 'col-span-3 @3xl:col-span-1' : ''}`}
            >
              <Skeleton className="h-3 w-full max-w-24" />
              <Skeleton className="h-8 w-full max-w-32" />
              <Skeleton className="h-3 w-full max-w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="order-2 rounded-lg border border-border bg-surface p-5 lg:order-1">
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="order-1 rounded-lg border border-border bg-surface p-5 lg:order-2">
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="mb-3 h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

/** Fila "Aguardando resposta" com os três estados (UX §2.7/§2.11). */
function QueuePanel({ today }: { today: ReturnType<typeof useToday> }): React.JSX.Element {
  return (
    <Panel
      id="home-fila"
      eyebrow="Fila"
      title="Aguardando resposta"
      aside={
        today.data && today.data.waitingTotal > 0 ? (
          <span className="font-mono text-sm tabular-nums text-text-mid">
            {today.data.waitingTotal}
          </span>
        ) : null
      }
    >
      {today.data ? (
        <WaitingQueue data={today.data} />
      ) : today.isError ? (
        <ErrorState
          title="Não foi possível carregar a fila"
          reason="A conexão com o servidor falhou."
          whatToDo="Tente de novo em instantes."
          action={
            <Button
              variant="secondary"
              loading={today.isFetching}
              onClick={() => void today.refetch()}
            >
              Tentar de novo
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3 p-4" aria-busy aria-label="Carregando a fila">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
    </Panel>
  );
}

function AgendaPanel({
  today,
  title,
  className,
}: {
  today: ReturnType<typeof useToday>;
  title: string;
  className?: string;
}): React.JSX.Element {
  return (
    <Panel id="home-agenda" eyebrow="Hoje" title={title} className={className}>
      {today.data ? (
        <TodayAgenda appointments={today.data.appointments} />
      ) : today.isError ? (
        <p className="px-4 py-6 font-body text-sm text-text-mid sm:px-6">
          A agenda não carregou. Ela volta sozinha na próxima atualização.
        </p>
      ) : (
        <div className="p-4" aria-busy aria-label="Carregando a agenda">
          <Skeleton className="h-16 w-full" />
        </div>
      )}
    </Panel>
  );
}

export function HomeClient(): React.JSX.Element {
  const router = useRouter();
  const name = useAuthStore((s) => s.auth?.name);
  const role = useAuthStore((s) => s.auth?.role);
  // Os alertas de `/me` (SLA do dia, orçamento de IA) já vêm filtrados por papel e
  // entram na mesma lista de atenção; é a query que o painel completo usa de qualquer
  // jeito. A janela padrão vem do "Período padrão" salvo na personalização (F8).
  const dashboard = useDashboard();
  const [chosen, setChosen] = useState<HomePeriodDays | null>(null);
  const period = chosen ?? periodFromPreference(dashboard.data?.layoutPreferences.period);

  const home = useHome(period);
  const today = useToday();
  const { connected } = useHomeSocket();

  const data = home.data;
  const switching = home.isPlaceholderData;
  const rows = useMemo(
    () =>
      data ? buildAttentionRows(data.attention, data.thresholds, dashboard.data?.alerts ?? []) : [],
    [data, dashboard.data?.alerts],
  );

  const serverTime = data ? new Date(data.serverTime) : null;
  const greeting = serverTime ? greetingForHour(serverTime.getHours()) : '';
  const who = firstName(name);
  const dateLabel = serverTime
    ? serverTime.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long' })
    : '';

  const personal = data?.scope === 'personal';
  // Atendente com fila vazia não é "empresa nova": vê a fila e a agenda, não o convite.
  const empty = data ? !personal && isHomeEmpty(data) && rows.length === 0 : false;
  const canConnect = role ? can(role, 'channel.connect') : false;

  return (
    <div className="flex flex-col gap-6 pb-8 md:gap-8" data-tour-id="dashboard-header">
      <header className="flex flex-col gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">
            {dateLabel || 'Home'}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="font-head text-h3 text-text md:text-h2">
              {data ? `${greeting}${who ? `, ${who}` : ''}.` : 'Home'}
            </h1>
            <HelpHint k="dashboard.overview" />
          </div>
          <div className="mt-2 min-h-6 max-w-2xl">
            {data ? (
              <p className="font-body text-body text-text-mid" aria-live="polite">
                {buildHeadline(data)}
              </p>
            ) : (
              !home.isError && <Skeleton className="h-5 w-72 max-w-full" />
            )}
          </div>
        </div>
        {/* A janela e os controles dividem uma linha (centro com centro): o seletor
            fica ao lado do que ele muda, e o selo ao vivo ao lado do que ele atesta.
            Em tela estreita, os controles descem para a linha de baixo. */}
        {data && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="font-mono text-xs tabular-nums text-text-low" data-home-window>
              {personal
                ? `Sua fila agora · velocidade dos últimos ${data.periodDays}\u00a0dias`
                : `Últimos ${data.periodDays}\u00a0dias · ${comparisonLabel(data.window)}`}
            </p>
            <div className="flex flex-wrap items-center gap-3" data-home-controls>
              <StatusPill tone={connected ? 'brand' : 'neutral'} live={connected}>
                {connected ? 'Ao vivo' : 'Atualiza a cada minuto'}
              </StatusPill>
              {!personal && (
                <PeriodSwitch value={period} onChange={setChosen} pending={switching} />
              )}
            </div>
          </div>
        )}
      </header>

      {home.isLoading && <HomeSkeleton />}

      {home.isError && !data && (
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState
            title="Não foi possível carregar a Home"
            reason="A conexão com o servidor falhou ou expirou."
            whatToDo="Verifique sua conexão e tente novamente."
            action={
              <Button
                variant="secondary"
                loading={home.isFetching}
                leftIcon={<RefreshCw className="size-4" />}
                onClick={() => void home.refetch()}
              >
                Tentar de novo
              </Button>
            }
          />
        </div>
      )}

      {data && (
        <>
          <KpiStrip kpis={data.kpis} scope={data.scope} pending={switching} />

          {empty ? (
            <>
              {/* Empresa nova: o próximo passo é o checklist da F43 (some sozinho quando
                  concluído ou dispensado); o convite abaixo fica como rede de segurança. */}
              <SetupChecklist />
              <div className="rounded-lg border border-border bg-surface" data-home-empty>
                <EmptyState
                  icon={Rocket}
                  title="Sua Home ganha vida com o primeiro lead"
                  description="Receita, velocidade de resposta e o que precisa de atenção aparecem aqui sozinhos, assim que as conversas começarem a entrar."
                  action={
                    canConnect ? (
                      <Button variant="primary" onClick={() => router.push('/settings/channels')}>
                        Conectar um canal
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => router.push('/conversations')}>
                        Abrir a Inbox
                      </Button>
                    )
                  }
                />
              </div>
            </>
          ) : (
            <>
              {/* No celular a atenção vem logo depois do resultado; no desktop ela fica
                  à direita do gráfico, como na maquete. */}
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <AttentionList rows={rows} className="order-1 lg:order-2" />
                {personal ? (
                  <div className="order-2 min-w-0 lg:order-1">
                    <QueuePanel today={today} />
                  </div>
                ) : (
                  <div className="order-2 min-w-0 lg:order-1">
                    <RevenueChart series={data.revenueSeries} periodDays={data.periodDays} />
                  </div>
                )}
              </div>

              {data.journey && <Journey journey={data.journey} periodDays={data.periodDays} />}

              <SetupChecklist />

              {personal ? (
                <AgendaPanel today={today} title="Sua agenda" />
              ) : (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <QueuePanel today={today} />
                  <AgendaPanel today={today} title="Agenda do dia" />
                </div>
              )}
            </>
          )}

          {/* O convite à instalação e o aviso de novo lead vivem na Home desde a F61.
              Cada um só aparece quando faz sentido pedir (plataforma, permissão, estado),
              e nunca acima do resultado. */}
          <InstallPrompt />
          <PushToggle />

          {!personal && <ReservedSlots />}
        </>
      )}

      <section
        aria-labelledby="home-painel"
        className="mt-4 flex flex-col gap-6 border-t border-border pt-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">
              Detalhe
            </p>
            <h2 id="home-painel" className="scroll-mt-24 font-head text-h4 text-text">
              Painel completo
            </h2>
          </div>
          {dashboard.data && (
            <span data-tour-id="dashboard-customize">
              <CustomizeDashboardButton />
            </span>
          )}
        </div>
        <DashboardPanels />
      </section>
    </div>
  );
}
