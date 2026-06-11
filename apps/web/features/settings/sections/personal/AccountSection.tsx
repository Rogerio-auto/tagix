'use client';

import { useMe } from './queries';

/** Conta: e-mail, MFA (futuro), exclusão de conta (futuro). Read-only no MVP. */
export default function AccountSection(): React.JSX.Element {
  const meQuery = useMe();
  const m = meQuery.data?.member;

  if (meQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="flex justify-between gap-3 border-b border-border/40 pb-3">
        <span className="text-sm text-text-low">E-mail</span>
        <span className="text-sm text-text">{m?.email ?? '—'}</span>
      </div>
      <div className="flex justify-between gap-3 border-b border-border/40 pb-3">
        <span className="text-sm text-text-low">Papel</span>
        <span className="text-sm text-text">{m?.role ?? '—'}</span>
      </div>
      <div className="rounded-md border border-dashed border-border p-4">
        <p className="text-sm font-medium text-text">MFA</p>
        <p className="text-xs text-text-low">
          Autenticação em dois fatores chega em uma fase futura.
        </p>
      </div>
      <div className="rounded-md border border-danger/40 p-4">
        <p className="text-sm font-medium text-danger">Excluir conta</p>
        <p className="text-xs text-text-low">
          A exclusão de conta é uma ação irreversível gerenciada pelo administrador do workspace.
        </p>
      </div>
    </div>
  );
}
