'use client';

/**
 * Fila "Aguardando resposta" da Home (herdada da tela Hoje, F61-S12, no DS 3.0).
 *
 * Quem espera há mais tempo está mais perto de fechar com o concorrente, então a
 * ordem é do mais frio ao mais novo, e a faixa traz a contagem da fila INTEIRA (o
 * servidor conta), não só das linhas carregadas. A linha é um link para a conversa
 * (ação primária = clique no corpo, UX §2.1); "Depois" e "Perdido" são ações
 * secundárias, com "Perdido" atrás de confirmação (UX §2.9).
 *
 * Linguagem segura para o cliente: nada de fila técnica, worker ou custo.
 */
import type * as React from 'react';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { Button, Modal } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { esperaCurta } from './format';
import { useWaitingActions } from './queries';
import type { TodayPayload, UrgencyBand, WaitingLead } from './types';

interface Faixa {
  readonly id: UrgencyBand;
  readonly titulo: string;
  readonly explicacao: string;
  /** Classes de cor da faixa; o sentido nunca é só a cor (há título e contagem). */
  readonly dot: string;
  readonly text: string;
}

/**
 * Ordem em que a pergunta aparece: o que esfriou primeiro. "Agora" usa o tom neutro
 * de informação: o verde da marca fica reservado ao resultado da Home.
 */
const FAIXAS: readonly Faixa[] = [
  {
    id: 'esfriando',
    titulo: 'Esfriando',
    explicacao: 'há mais de 1 hora',
    dot: 'bg-danger',
    text: 'text-danger',
  },
  {
    id: 'atencao',
    titulo: 'Atenção',
    explicacao: 'de 15 min a 1 hora',
    dot: 'bg-warn',
    text: 'text-warn',
  },
  {
    id: 'agora',
    titulo: 'Agora',
    explicacao: 'acabaram de escrever',
    dot: 'bg-info',
    text: 'text-info',
  },
];

/** Quantos leads cada faixa mostra antes de resumir o resto numa linha. */
const POR_FAIXA = 4;

function Linha({
  lead,
  faixa,
  ocupado,
  onDepois,
  onPerdido,
}: {
  lead: WaitingLead;
  faixa: Faixa;
  ocupado: boolean;
  onDepois: () => void;
  onPerdido: () => void;
}): React.JSX.Element {
  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
      <Link
        href={`/conversations/${lead.conversationId}`}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1 py-1.5 focus-visible:focus-ring"
      >
        <span aria-hidden className={cn('size-2 shrink-0 rounded-pill', faixa.dot)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body text-sm font-bold text-text">
            {lead.contactName ?? 'Sem identificação'}
          </span>
          {lead.preview !== null && (
            <span className="block truncate font-body text-sm text-text-low">{lead.preview}</span>
          )}
        </span>
        <span className={cn('shrink-0 font-mono text-xs tabular-nums', faixa.text)}>
          {esperaCurta(lead.waitingMinutes)}
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-text-low motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
        />
      </Link>
      <div className="flex gap-2 pl-6 sm:pl-0">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 sm:flex-none"
          disabled={ocupado}
          onClick={onDepois}
        >
          Depois
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 hover:text-danger sm:flex-none"
          disabled={ocupado}
          onClick={onPerdido}
        >
          Perdido
        </Button>
      </div>
    </li>
  );
}

export function WaitingQueue({ data }: { data: TodayPayload }): React.JSX.Element {
  const { depois, perdido } = useWaitingActions();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const { waiting, waitingTotal, waitingBands } = data;

  if (waitingTotal === 0) {
    // Zero é resposta, e é uma boa. Vazio sem explicação parece defeito.
    return (
      <div className="flex items-center gap-3 px-4 py-8 sm:px-6">
        <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" />
        <div>
          <p className="font-body text-sm font-bold text-text">Ninguém esperando.</p>
          <p className="font-body text-sm text-text-low">
            Todo mundo que escreveu já foi respondido.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Tamanho do problema: proporção e contagem, lado a lado. */}
      <div className="px-4 pt-4 sm:px-6">
        <div
          className="flex h-1.5 gap-0.5 overflow-hidden rounded-pill"
          role="img"
          aria-label={FAIXAS.map(
            (f) => `${waitingBands[f.id] ?? 0} ${f.titulo.toLowerCase()}`,
          ).join(', ')}
        >
          {FAIXAS.map((f) => {
            const n = waitingBands[f.id] ?? 0;
            return n > 0 ? (
              <span
                key={f.id}
                className={cn('h-full', f.dot)}
                style={{ flexGrow: n, flexBasis: 0 }}
              />
            ) : null;
          })}
        </div>
      </div>

      <div className="mt-2 divide-y divide-border">
        {FAIXAS.map((faixa) => {
          const total = waitingBands[faixa.id] ?? 0;
          if (total === 0) return null;
          const mostrados = waiting.filter((w) => w.urgency === faixa.id).slice(0, POR_FAIXA);
          const restantes = total - mostrados.length;
          return (
            <section key={faixa.id} aria-label={faixa.titulo} className="py-2">
              <div className="flex items-baseline gap-2 px-4 pb-1 pt-2 sm:px-6">
                <h3
                  className={cn(
                    'font-mono text-xs font-medium uppercase tracking-widest',
                    faixa.text,
                  )}
                >
                  {faixa.titulo}
                </h3>
                <span className="font-mono text-xs tabular-nums text-text">{total}</span>
                <span className="font-body text-xs text-text-low">{faixa.explicacao}</span>
              </div>
              <ul>
                {mostrados.map((lead) => (
                  <Linha
                    key={lead.conversationId}
                    lead={lead}
                    faixa={faixa}
                    ocupado={ocupado === lead.conversationId}
                    onDepois={() => {
                      setOcupado(lead.conversationId);
                      depois.mutate(lead.conversationId, { onSettled: () => setOcupado(null) });
                    }}
                    onPerdido={() => setConfirmando(lead.conversationId)}
                  />
                ))}
              </ul>
              {restantes > 0 && (
                <Link
                  href="/conversations?status=open"
                  className="mx-4 mt-1 inline-flex min-h-8 items-center rounded-sm px-1 font-body text-sm font-bold text-brand-text hover:underline focus-visible:focus-ring sm:mx-6"
                >
                  {restantes === 1 ? 'Ver mais 1 nesta faixa' : `Ver mais ${restantes} nesta faixa`}
                </Link>
              )}
            </section>
          );
        })}
      </div>

      {/* Confirmação de "Perdido": destrutivo o bastante para não acontecer sem querer. */}
      <Modal
        open={confirmando !== null}
        onClose={() => setConfirmando(null)}
        initialFocusRef={cancelRef}
        title="Marcar como perdido?"
        description="A conversa sai da fila e entra no resultado do período como não fechada. Você continua vendo tudo em Conversas."
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={perdido.isPending}
              onClick={() => {
                if (confirmando === null) return;
                perdido.mutate(confirmando, { onSettled: () => setConfirmando(null) });
              }}
            >
              Marcar perdido
            </Button>
          </>
        }
      />
    </div>
  );
}
