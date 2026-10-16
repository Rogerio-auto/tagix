'use client';

/**
 * Página de view-as (F26-S09; DS 3.0 na F72-S08): quando há `?workspace=` (vindo do 360),
 * oferece o "Ver como" pré-direcionado num painel de aviso; sempre lista as sessões
 * ativas com o kill-switch. Fluxo inalterado: só leitura, motivo obrigatório, auditado.
 */
import { useSearchParams } from 'next/navigation';
import { Eye } from 'lucide-react';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { Panel } from '../ui/kit';
import { ActiveSessions } from './ActiveSessions';
import { ViewAsButton } from './ViewAsButton';

export function ImpersonationView() {
  const params = useSearchParams();
  const workspaceId = params.get('workspace');

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/impersonation"
        title="Ver como"
        description="Sessões somente leitura no contexto de um tenant, com motivo, prazo e auditoria."
        help={
          <p>
            Durante a sessão você navega pelo app como o tenant vê, mas nenhuma escrita é aceita pela
            API. A faixa de view-as no topo do app fica visível o tempo todo e tem o botão Sair.
          </p>
        }
      />
      <div className="flex flex-col gap-6">
        {workspaceId && (
          <Panel
            tone="warn"
            icon={Eye}
            title="Iniciar view-as deste tenant"
            titleId="impersonation-start"
            description={
              <>
                Workspace <span className="font-mono text-text-mid">{workspaceId}</span> · somente leitura, com
                motivo e prazo.
              </>
            }
            action={<ViewAsButton workspaceId={workspaceId} />}
          />
        )}
        <ActiveSessions />
      </div>
    </div>
  );
}
