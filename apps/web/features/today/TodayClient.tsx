'use client';

/**
 * Tela "Hoje" — a visão de dono (F61-S02 — APP_MOBILE_PLAN §3.1).
 *
 * O dono do negócio abre isto no semáforo. Se precisar de dois toques para saber
 * se tem lead esperando, falhou.
 *
 * Três blocos, nesta ordem, porque é a ordem em que a pergunta aparece na cabeça
 * dele: quem está esperando · o que tem hoje · como está o mês.
 *
 * **Linguagem segura para o cliente:** nada de fila, worker, provider ou custo de
 * modelo. "Aguardando resposta", "Hoje", "Este mês".
 */
import type * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/shared/lib/api-client';

interface WaitingLead {
  conversationId: string;
  contactName: string | null;
  preview: string | null;
  waitingSince: string;
  waitingMinutes: number;
  channel: string;
}

interface TodayAppointment {
  id: string;
  title: string;
  startsAt: string;
  contactName: string | null;
}

interface TodayPayload {
  waiting: WaitingLead[];
  waitingTotal: number;
  appointments: TodayAppointment[];
  month: {
    leads: number;
    leadsPrevious: number;
    appointments: number;
    appointmentsPrevious: number;
    conversations: number;
    conversationsPrevious: number;
  };
  serverTime: string;
}

/**
 * Espera em linguagem humana.
 *
 * "há 12 min" diz alguma coisa; "14:32" obriga o dono a fazer a conta enquanto
 * dirige. Os minutos vêm calculados do servidor — o relógio do celular pode estar
 * errado, e é justamente este número que decide se ele para o que está fazendo.
 */
function esperaEmTexto(minutos: number): string {
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

/** Acima de 15 minutos o lead já está pedindo orçamento para outro. */
function urgencia(minutos: number): 'calma' | 'atencao' | 'urgente' {
  if (minutos >= 60) return 'urgente';
  if (minutos >= 15) return 'atencao';
  return 'calma';
}

const COR_URGENCIA: Record<ReturnType<typeof urgencia>, string> = {
  calma: 'bg-brand',
  atencao: 'bg-warning',
  urgente: 'bg-danger',
};

function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Variação contra o mês anterior, já em texto. Honesta quando o mês está pior. */
function variacao(atual: number, anterior: number): { texto: string; positiva: boolean | null } {
  if (anterior === 0) {
    return atual === 0
      ? { texto: 'igual ao mês passado', positiva: null }
      : { texto: 'primeiro do mês passado para cá', positiva: true };
  }
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return { texto: 'igual ao mês passado', positiva: null };
  return {
    texto: `${pct > 0 ? '+' : ''}${pct}% vs mês passado`,
    positiva: pct > 0,
  };
}

function Metrica({
  rotulo,
  valor,
  anterior,
}: {
  rotulo: string;
  valor: number;
  anterior: number;
}): React.JSX.Element {
  const v = variacao(valor, anterior);
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-small text-text-2">{rotulo}</p>
      <p className="mt-1 font-head text-h2 leading-none text-text">{valor}</p>
      <p
        className={`mt-2 text-small ${
          v.positiva === null ? 'text-text-3' : v.positiva ? 'text-brand' : 'text-danger'
        }`}
      >
        {v.texto}
      </p>
    </div>
  );
}

export function TodayClient(): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery<TodayPayload>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => api.get<TodayPayload>('/api/dashboard/today'),
    // O dono deixa a tela aberta. Atualizar sozinho evita que ele veja um número
    // velho e conclua que ninguém está esperando.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Carregando">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-center">
        <p className="text-body text-text">Não consegui carregar agora.</p>
        <p className="mt-1 text-small text-text-2">Pode ser a conexão. Tente de novo.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="touch-target mt-4 rounded-md bg-brand px-4 py-2 font-semibold text-text-on-brand"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const { waiting, waitingTotal, appointments, month } = data;

  return (
    <div className="space-y-6 pb-8">
      {/* ── Aguardando resposta ─────────────────────────────────────────────── */}
      <section aria-labelledby="hoje-esperando">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="hoje-esperando" className="font-head text-h3 text-text">
            Aguardando resposta
          </h2>
          {waitingTotal > waiting.length && (
            <span className="text-small text-text-2">{waitingTotal} no total</span>
          )}
        </div>

        {waiting.length === 0 ? (
          // Zero é resposta, e é uma boa. Vazio sem explicação parece defeito.
          <div className="rounded-md border border-border bg-surface p-6 text-center">
            <p className="text-body text-text">Ninguém esperando.</p>
            <p className="mt-1 text-small text-text-2">Todo mundo que escreveu já foi respondido.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {waiting.map((lead) => {
              const nivel = urgencia(lead.waitingMinutes);
              return (
                <li key={lead.conversationId}>
                  <Link
                    href={`/conversations?c=${lead.conversationId}`}
                    className="touch-target flex items-start gap-3 rounded-md border border-border bg-surface p-4 active:bg-surface-2"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${COR_URGENCIA[nivel]}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold text-text">
                          {lead.contactName ?? 'Contato sem nome'}
                        </span>
                        <span
                          className={`shrink-0 text-small ${
                            nivel === 'urgente' ? 'text-danger' : 'text-text-2'
                          }`}
                        >
                          {esperaEmTexto(lead.waitingMinutes)}
                        </span>
                      </span>
                      {lead.preview && (
                        <span className="mt-1 line-clamp-2 block text-small text-text-2">
                          {lead.preview}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Hoje ────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="hoje-agenda">
        <h2 id="hoje-agenda" className="mb-3 font-head text-h3 text-text">
          Hoje
        </h2>
        {appointments.length === 0 ? (
          <div className="rounded-md border border-border bg-surface p-6 text-center">
            <p className="text-body text-text">Nada marcado para hoje.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {appointments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-md border border-border bg-surface p-4"
              >
                <span className="shrink-0 font-price text-body text-brand">
                  {horaLocal(a.startsAt)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-text">{a.title}</span>
                  {a.contactName && (
                    <span className="block truncate text-small text-text-2">{a.contactName}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Este mês ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="hoje-mes">
        <h2 id="hoje-mes" className="mb-3 font-head text-h3 text-text">
          Este mês
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <Metrica rotulo="Leads" valor={month.leads} anterior={month.leadsPrevious} />
          <Metrica
            rotulo="Conversas"
            valor={month.conversations}
            anterior={month.conversationsPrevious}
          />
          <Metrica
            rotulo="Agendados"
            valor={month.appointments}
            anterior={month.appointmentsPrevious}
          />
        </div>
      </section>
    </div>
  );
}
