'use client';

/**
 * Estado do pedido de exclusão (F69-S01).
 *
 * Busca pelo mesmo domínio (`/api/...` é reescrito para a API pelo Next), sem
 * sessão e sem o cliente autenticado do app — que redireciona para o login em 401
 * e aqui não há login nenhum.
 */
import type * as React from 'react';
import { useEffect, useState } from 'react';
import { formatDateTime } from '@/shared/lib/locale';

type StatusPedido = 'received' | 'completed' | 'no_data' | 'failed';

/** Corpo de `GET /api/meta/data-deletion/:code`. */
interface RespostaPedido {
  status: StatusPedido;
  requestedAt: string;
  completedAt: string | null;
}

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'erro' }
  | ({ tipo: 'ok' } & RespostaPedido);

/** O que cada estado significa para quem pediu, sem jargão. */
const TEXTO: Record<'received' | 'completed' | 'no_data' | 'failed', string> = {
  received: 'Recebemos seu pedido e ele está sendo processado.',
  completed: 'Seu pedido foi concluído. Os dados ligados à sua conta foram excluídos.',
  no_data:
    'Seu pedido foi concluído. Não encontramos dados ligados à sua conta, então não havia nada a excluir.',
  failed:
    'Houve um problema ao concluir seu pedido. Ele continua registrado e será refeito; se preferir, escreva para suporte@leadium.com.br informando o código acima.',
};

/** Rótulo curto do estado, ao lado do texto completo (cor nunca sozinha, WCAG 1.4.1). */
const ROTULO: Record<StatusPedido, { texto: string; tom: string }> = {
  received: { texto: 'Em andamento', tom: 'border-info/30 bg-info/10' },
  completed: { texto: 'Concluído', tom: 'border-success/30 bg-success/10' },
  no_data: { texto: 'Concluído', tom: 'border-success/30 bg-success/10' },
  failed: { texto: 'Com problema', tom: 'border-danger/30 bg-danger/10' },
};

const PONTO: Record<StatusPedido, string> = {
  received: 'bg-info',
  completed: 'bg-success',
  no_data: 'bg-success',
  failed: 'bg-danger',
};

export function DeletionStatus({ codigo }: { codigo: string }): React.JSX.Element {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });

  useEffect(() => {
    let vivo = true;
    fetch(`/api/meta/data-deletion/${encodeURIComponent(codigo)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!vivo) return;
        if (res.status === 404) {
          setEstado({ tipo: 'nao_encontrado' });
          return;
        }
        if (!res.ok) {
          setEstado({ tipo: 'erro' });
          return;
        }
        const corpo = (await res.json()) as Extract<Estado, { tipo: 'ok' }> extends infer T
          ? Omit<T & object, 'tipo'>
          : never;
        setEstado({ tipo: 'ok', ...corpo });
      })
      .catch(() => {
        if (vivo) setEstado({ tipo: 'erro' });
      });
    return () => {
      vivo = false;
    };
  }, [codigo]);

  if (estado.tipo === 'carregando') {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <span className="sr-only">Consultando o pedido…</span>
        <div aria-hidden className="h-6 w-28 rounded-pill bg-surface-3 motion-safe:animate-pulse" />
        <div aria-hidden className="h-4 w-full rounded-xs bg-surface-3 motion-safe:animate-pulse" />
        <div aria-hidden className="h-4 w-2/3 rounded-xs bg-surface-3 motion-safe:animate-pulse" />
      </div>
    );
  }
  if (estado.tipo === 'nao_encontrado') {
    return (
      <Aviso titulo="Pedido não encontrado">
        Não encontramos um pedido com este código. Confira se o endereço está completo.
      </Aviso>
    );
  }
  if (estado.tipo === 'erro') {
    return (
      <Aviso titulo="Consulta indisponível" alerta>
        Não foi possível consultar agora. Tente de novo em alguns minutos.
      </Aviso>
    );
  }

  const rotulo = ROTULO[estado.status];
  return (
    <section aria-label="Estado do pedido" className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-ds-1">
      <p
        className={`inline-flex w-fit items-center gap-2 rounded-pill border px-3 py-1 font-mono text-xs font-medium uppercase tracking-[0.12em] text-text ${rotulo.tom}`}
      >
        <span aria-hidden className={`size-1.5 rounded-full ${PONTO[estado.status]}`} />
        {rotulo.texto}
      </p>
      <p className="font-body text-[1.0625rem] leading-[1.75] text-text">{TEXTO[estado.status]}</p>
      <ol className="flex flex-col border-l border-border">
        <Marco rotulo="Pedido recebido" quando={estado.requestedAt} />
        {estado.completedAt !== null && <Marco rotulo="Concluído" quando={estado.completedAt} />}
      </ol>
    </section>
  );
}

function Marco({ rotulo, quando }: { rotulo: string; quando: string }): React.JSX.Element {
  return (
    <li className="relative flex flex-col gap-0.5 pb-3 pl-5 last:pb-0">
      <span aria-hidden className="absolute -left-[4.5px] top-2 size-2 rounded-full bg-text-low" />
      <span className="font-body text-sm text-text-mid">{rotulo}</span>
      <time dateTime={quando} className="font-mono text-sm tabular-nums text-text">
        {formatDateTime(quando)}
      </time>
    </li>
  );
}

function Aviso({
  titulo,
  alerta = false,
  children,
}: {
  titulo: string;
  alerta?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div role={alerta ? 'alert' : 'status'} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-6">
      <p className="font-body font-bold text-text">{titulo}</p>
      <p className="font-body text-body text-text-mid">{children}</p>
    </div>
  );
}
