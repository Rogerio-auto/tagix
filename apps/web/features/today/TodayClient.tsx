'use client';

/**
 * Tela "Hoje" — a visão de dono (F61-S02, enriquecida na F61-S12).
 *
 * O dono do negócio abre isto no semáforo. Se precisar de dois toques para saber
 * se tem lead esperando, falhou.
 *
 * Três blocos, nesta ordem, porque é a ordem em que a pergunta aparece na cabeça
 * dele: quem está esperando · o que tem hoje · como está o mês.
 *
 * ## O que a F61-S12 mudou, e por quê
 *
 * A primeira versão tinha a estrutura certa e o conteúdo errado: 199 de 200
 * contatos apareciam como "Contato sem nome", a prévia dizia `[voice]`, e a
 * única ação possível era abrir a conversa. Uma tela de decisão onde as linhas
 * são indistinguíveis e nada pode ser decidido.
 *
 * - **Identidade**: nome do CRM, ou telefone formatado. Nunca "sem nome".
 * - **Prévia**: humanizada no servidor. `[voice]` virou "🎤 Mensagem de voz".
 * - **Ação**: Depois e Perdido tiram a linha da tela — e Perdido registra por quê.
 * - **Distribuição**: 61 esperando viram três faixas de urgência com contagem,
 *   em vez de um top-10 que só mostrava os mais frios.
 *
 * **Linguagem segura para o cliente:** nada de fila, worker, provider ou custo de
 * modelo. "Aguardando resposta", "Hoje", "Este mês".
 */
import type * as React from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/shared/lib/api-client';
import { InstallPrompt } from '@/shared/pwa';

type UrgencyBand = 'esfriando' | 'atencao' | 'agora';

interface WaitingLead {
  conversationId: string;
  contactId: string | null;
  contactName: string | null;
  preview: string | null;
  waitingSince: string;
  waitingMinutes: number;
  channel: string;
  urgency: UrgencyBand;
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
  waitingBands: Record<UrgencyBand, number>;
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

/**
 * As três faixas, na ordem em que o dono precisa vê-las.
 *
 * "Esfriando" primeiro contraria a intuição de mostrar o mais novo no topo — e é
 * de propósito. Quem espera há duas horas é quem está prestes a fechar com o
 * concorrente; quem escreveu há três minutos ainda está esperando com paciência.
 */
const FAIXAS: readonly {
  id: UrgencyBand;
  titulo: string;
  explicacao: string;
  cor: string;
  texto: string;
}[] = [
  {
    id: 'esfriando',
    titulo: 'Esfriando',
    explicacao: 'esperando há mais de 1 hora',
    cor: 'bg-danger',
    texto: 'text-danger',
  },
  {
    id: 'atencao',
    titulo: 'Atenção',
    explicacao: 'entre 15 minutos e 1 hora',
    cor: 'bg-warning',
    texto: 'text-warning',
  },
  {
    id: 'agora',
    titulo: 'Agora',
    explicacao: 'acabaram de escrever',
    cor: 'bg-brand',
    texto: 'text-text-2',
  },
];

/** Quantos leads cada faixa mostra antes de resumir o resto numa linha. */
const POR_FAIXA = 5;

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
  return { texto: `${pct > 0 ? '+' : ''}${pct}% vs mês passado`, positiva: pct > 0 };
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

/**
 * Uma linha da fila: quem é, o que disse, há quanto tempo, e o que fazer.
 *
 * As ações ficam abaixo do conteúdo e ocupam a largura toda — o polegar de quem
 * segura o celular com uma mão só alcança a base, não o canto superior direito.
 */
function LinhaEspera({
  lead,
  ocupado,
  onDepois,
  onPerdido,
}: {
  lead: WaitingLead;
  ocupado: boolean;
  onDepois: () => void;
  onPerdido: () => void;
}): React.JSX.Element {
  const faixa = FAIXAS.find((f) => f.id === lead.urgency) ?? FAIXAS[2]!;
  return (
    <li className="rounded-md border border-border bg-surface">
      <Link
        href={`/conversations?c=${lead.conversationId}`}
        className="flex items-start gap-3 p-4 active:bg-surface-2"
      >
        <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${faixa.cor}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold text-text">
              {/* Sem nome E sem telefone é o único caso em que não há identidade
                  nenhuma — e aí "sem identificação" é honesto, enquanto
                  "Contato sem nome" soava como defeito do produto. */}
              {lead.contactName ?? 'Sem identificação'}
            </span>
            <span className={`shrink-0 text-small ${faixa.texto}`}>
              {esperaEmTexto(lead.waitingMinutes)}
            </span>
          </span>
          {lead.preview !== null && (
            <span className="mt-1 line-clamp-2 block text-small text-text-2">{lead.preview}</span>
          )}
        </span>
      </Link>

      <div className="flex border-t border-border">
        <button
          type="button"
          onClick={onDepois}
          disabled={ocupado}
          className="touch-target flex-1 rounded-bl-md py-3 text-small font-medium text-text-2 active:bg-surface-2 disabled:opacity-50"
        >
          Depois
        </button>
        <span aria-hidden="true" className="w-px bg-border" />
        <button
          type="button"
          onClick={onPerdido}
          disabled={ocupado}
          className="touch-target flex-1 rounded-br-md py-3 text-small font-medium text-danger active:bg-surface-2 disabled:opacity-50"
        >
          Perdido
        </button>
      </div>
    </li>
  );
}

export function TodayClient(): React.JSX.Element {
  const qc = useQueryClient();
  /** Confirmação de "Perdido": destrutivo o bastante para não acontecer sem querer. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<TodayPayload>({
    queryKey: ['dashboard', 'today'],
    queryFn: () => api.get<TodayPayload>('/api/dashboard/today'),
    // O dono deixa a tela aberta. Atualizar sozinho evita que ele veja um número
    // velho e conclua que ninguém está esperando.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const invalidar = (): void => {
    void qc.invalidateQueries({ queryKey: ['dashboard', 'today'] });
    // A lista de conversas mostra as mesmas conversas — deixá-la velha faria o
    // lead reaparecer como aberto na outra tela.
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  };

  /** Adia para amanhã de manhã: sai de hoje e volta quando dá para agir. */
  const depois = useMutation({
    mutationFn: (conversationId: string) => {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      amanha.setHours(8, 0, 0, 0);
      return api.post(`/api/conversations/${conversationId}/status`, {
        status: 'snoozed',
        snoozedUntil: amanha.toISOString(),
      });
    },
    onSettled: () => {
      setOcupado(null);
      invalidar();
    },
  });

  /** Uma chamada: fecha o card como perdido e resolve a conversa. */
  const perdido = useMutation({
    mutationFn: (conversationId: string) =>
      api.post(`/api/dashboard/today/${conversationId}/lost`, {}),
    onSettled: () => {
      setOcupado(null);
      setConfirmando(null);
      invalidar();
    },
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

  const { waiting, waitingTotal, waitingBands, appointments, month } = data;

  return (
    <div className="space-y-6 pb-8">
      {/* F61-S05: o convite vive AQUI, e não no app inteiro. Quem instala é o dono
          que abre o celular entre uma tarefa e outra — e no iPhone a instalação é
          a condição para o aviso de lead novo existir. */}
      <InstallPrompt />

      {/* ── Aguardando resposta ─────────────────────────────────────────────── */}
      <section aria-labelledby="hoje-esperando">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="hoje-esperando" className="font-head text-h3 text-text">
            Aguardando resposta
          </h2>
          {waitingTotal > 0 && (
            <span className="text-small text-text-2">
              {waitingTotal === 1 ? '1 pessoa' : `${waitingTotal} pessoas`}
            </span>
          )}
        </div>

        {waitingTotal === 0 ? (
          // Zero é resposta, e é uma boa. Vazio sem explicação parece defeito.
          <div className="rounded-md border border-border bg-surface p-6 text-center">
            <p className="text-body text-text">Ninguém esperando.</p>
            <p className="mt-1 text-small text-text-2">Todo mundo que escreveu já foi respondido.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {FAIXAS.map((faixa) => {
              const total = waitingBands[faixa.id] ?? 0;
              if (total === 0) return null;
              const daFaixa = waiting.filter((w) => w.urgency === faixa.id);
              const mostrados = daFaixa.slice(0, POR_FAIXA);
              const restantes = total - mostrados.length;

              return (
                <div key={faixa.id}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <h3 className={`font-head text-body ${faixa.texto}`}>{faixa.titulo}</h3>
                    <span className="font-price text-body text-text">{total}</span>
                    <span className="text-small text-text-3">· {faixa.explicacao}</span>
                  </div>
                  <ul className="space-y-2">
                    {mostrados.map((lead) => (
                      <LinhaEspera
                        key={lead.conversationId}
                        lead={lead}
                        ocupado={ocupado === lead.conversationId}
                        onDepois={() => {
                          setOcupado(lead.conversationId);
                          depois.mutate(lead.conversationId);
                        }}
                        onPerdido={() => setConfirmando(lead.conversationId)}
                      />
                    ))}
                  </ul>
                  {restantes > 0 && (
                    <Link
                      href="/conversations?status=open"
                      className="touch-target mt-2 block rounded-md border border-border bg-surface px-4 py-3 text-center text-small text-text-2 active:bg-surface-2"
                    >
                      {restantes === 1 ? 'mais 1 nesta faixa' : `mais ${restantes} nesta faixa`}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
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
                  {a.contactName !== null && (
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

      {/* ── Confirmação de "Perdido" ────────────────────────────────────────── */}
      {confirmando !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirma-perdido"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <h3 id="confirma-perdido" className="font-head text-h3 text-text">
              Marcar como perdido?
            </h3>
            <p className="mt-2 text-small text-text-2">
              A conversa sai desta tela e entra no resultado do mês como não fechada. Você continua
              vendo tudo em Conversas.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmando(null)}
                className="touch-target flex-1 rounded-md border border-border py-3 font-medium text-text active:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setOcupado(confirmando);
                  perdido.mutate(confirmando);
                }}
                className="touch-target flex-1 rounded-md bg-danger py-3 font-semibold text-text-on-brand active:opacity-90"
              >
                Marcar perdido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
