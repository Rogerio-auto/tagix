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

function dataLegivel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

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
    return <p className="mt-6 text-body text-text-2">Consultando o pedido…</p>;
  }
  if (estado.tipo === 'nao_encontrado') {
    return (
      <p className="mt-6 text-body text-text-2">
        Não encontramos um pedido com este código. Confira se o endereço está completo.
      </p>
    );
  }
  if (estado.tipo === 'erro') {
    return (
      <p className="mt-6 text-body text-text-2">
        Não foi possível consultar agora. Tente de novo em alguns minutos.
      </p>
    );
  }

  return (
    <div className="mt-6 rounded-md border border-border bg-surface p-5">
      <p className="text-body text-text">{TEXTO[estado.status]}</p>
      <p className="mt-3 text-small text-text-3">Pedido recebido em {dataLegivel(estado.requestedAt)}</p>
      {estado.completedAt !== null && (
        <p className="text-small text-text-3">Concluído em {dataLegivel(estado.completedAt)}</p>
      )}
    </div>
  );
}
