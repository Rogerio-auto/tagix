'use client';

import { ShieldCheck } from 'lucide-react';
import { Badge } from '@hm/ui';
import { roleLabel } from '@/features/invites/types';
import { Panel, SectionLoading } from './components';
import { useMe } from './queries';

/** Conta: e-mail, MFA (futuro), exclusão de conta (futuro). Read-only no MVP. */
export default function AccountSection(): React.JSX.Element {
  const meQuery = useMe();
  const m = meQuery.data?.member;

  if (meQuery.isLoading) return <SectionLoading rows={2} label="Carregando conta" />;

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Identidade" body="flush">
        <dl className="divide-y divide-border px-5">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <dt className="font-body text-sm text-text-low">E-mail</dt>
            <dd className="font-mono text-sm text-text">{m?.email ?? '—'}</dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <dt className="font-body text-sm text-text-low">Papel neste workspace</dt>
            <dd>
              {m?.role ? (
                <Badge tone="neutral" size="sm">
                  {roleLabel(m.role)}
                </Badge>
              ) : (
                <span className="text-sm text-text">—</span>
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      <div className="flex gap-3 rounded-lg border border-dashed border-border-2 p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-text-low" aria-hidden />
        <div>
          <p className="font-body text-sm font-bold text-text">Verificação em duas etapas</p>
          <p className="mt-0.5 font-body text-sm text-text-low">Chega em uma fase futura.</p>
        </div>
      </div>

      <Panel tone="danger" title="Excluir conta">
        <p className="font-body text-sm text-text-mid">
          A exclusão de conta é uma ação irreversível gerenciada pelo administrador do workspace.
        </p>
      </Panel>
    </div>
  );
}
