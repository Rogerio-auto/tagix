import type * as React from 'react';
import { DeletionStatus } from './DeletionStatus';

export const metadata = { title: 'Acompanhar exclusão de dados · Leadium' };

/**
 * Página pública de acompanhamento do pedido de exclusão (F69-S01).
 *
 * É a URL que devolvemos à Meta no callback de exclusão; a Meta a mostra à pessoa
 * junto com o código de confirmação. Abre sem login e não exibe dado nenhum além
 * do estado do pedido.
 */
export default async function ExclusaoDeDadosPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}): Promise<React.JSX.Element> {
  const { codigo } = await params;
  return (
    <article>
      <h1 className="font-head text-h1">Exclusão de dados</h1>
      <p className="mt-2 text-body text-text-2">
        Código de confirmação: <span className="font-mono text-text">{codigo}</span>
      </p>
      <DeletionStatus codigo={codigo} />
    </article>
  );
}
