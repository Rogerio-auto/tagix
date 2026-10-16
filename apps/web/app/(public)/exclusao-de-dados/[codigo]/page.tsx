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
    <article className="flex max-w-[68ch] flex-col gap-10">
      <header className="flex flex-col gap-5">
        <p className="flex items-center gap-2.5 font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low">
          <span aria-hidden className="h-px w-5 bg-border-2" />
          Pedido de exclusão
        </p>
        <h1 className="font-head text-h2 text-balance text-text md:text-h1">Exclusão de dados</h1>
        <p className="font-body text-lg leading-[1.7] text-text-mid">
          Acompanhe aqui o pedido que você fez pelas configurações do Facebook ou do Instagram.
        </p>
        <dl className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <dt className="font-body text-sm text-text-mid">Código de confirmação</dt>
          <dd className="rounded-sm border border-border bg-surface-2 px-2.5 py-1 font-mono text-sm text-text wrap-anywhere">
            {codigo}
          </dd>
        </dl>
      </header>
      <DeletionStatus codigo={codigo} />
    </article>
  );
}
