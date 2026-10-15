'use client';

/**
 * Configurações → IA: trava de origem do workspace (F70-S30).
 *
 * Um interruptor decide se a IA automática só atende quem chegou por anúncio, site ou
 * Instagram (ligada, padrão) ou qualquer conversa (desligada). Ligar aplica na hora;
 * desligar pede confirmação, porque abre a IA para contatos pessoais do número. O
 * servidor restringe a OWNER/ADMIN e audita cada mudança; a seção só aparece para quem
 * tem `workspace.edit`.
 *
 * DS 3.0 (F72-S07): painel com hairline que muda para o tom de aviso quando a trava está
 * desligada. Só leitura (F71-S17): o interruptor e "Desligar a trava" ficam `aria-disabled`
 * com a explicação (a mudança é escrita na hora).
 */
import { useState } from 'react';
import { Button, ErrorState, Skeleton, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { formatDateTime } from '@/shared/lib/locale';
import { Panel, Toggle, eyebrowClass } from '../personal/components';
import { useAiOriginLock, useSetAiOriginLock, type AiOriginLockLastChange } from './queries';

const SWITCH_TITLE = 'Responder só quem chegou por anúncio, site ou Instagram';

function describeLastChange(change: AiOriginLockLastChange | null): string {
  if (change === null) return 'Nunca alterada. Todo workspace começa com a trava ligada.';
  const who = change.byName ?? change.byEmail ?? 'Um membro que saiu do workspace';
  const what = change.next ? 'ligou' : 'desligou';
  const when = formatDateTime(change.at, { dateStyle: 'medium', timeStyle: 'short' });
  return `${who} ${what} a trava em ${when}.`;
}

export default function AiOriginLockSection(): React.JSX.Element {
  const { toast } = useToast();
  const query = useAiOriginLock();
  const update = useSetAiOriginLock();
  const [confirmingOff, setConfirmingOff] = useState(false);

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Carregando a configuração da IA">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="Não foi possível carregar a configuração da IA"
        reason="O servidor não respondeu a tempo ou a sessão expirou."
        whatToDo="Tente de novo em alguns segundos."
        action={
          <Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const locked = query.data.aiRequiresProvenOrigin;

  const apply = async (next: boolean) => {
    try {
      await update.mutateAsync(next);
      setConfirmingOff(false);
      toast({
        variant: 'success',
        title: next
          ? 'Trava ligada. A IA volta a atender só quem chegou por anúncio, site ou Instagram.'
          : 'Trava desligada. A IA pode atender qualquer conversa.',
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: err instanceof Error ? err.message : 'Não foi possível salvar.',
      });
    }
  };

  const onToggle = (next: boolean) => {
    if (next) {
      setConfirmingOff(false);
      void apply(true);
      return;
    }
    setConfirmingOff(true);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <p className={eyebrowClass}>Atendimento automático</p>
        <h3 className="font-head text-lg font-semibold text-text">Quem a IA pode atender</h3>
        <p className="max-w-prose font-body text-sm leading-relaxed text-text-mid">
          A IA responde sozinha quando um fluxo, uma campanha ou uma retomada a liga numa
          conversa. Esta trava decide se ela pode fazer isso com qualquer pessoa ou só com quem
          chegou por um caminho comprovado.
        </p>
      </header>

      <Panel aria-labelledby="ai-origin-lock-title" tone={locked ? 'default' : 'warn'} body="flush">
        <div className="flex items-start justify-between gap-6 px-5 py-5">
          <div className="min-w-0">
            <p id="ai-origin-lock-title" className="font-body text-sm font-bold text-text">
              {SWITCH_TITLE}
            </p>
            <p className="mt-1 font-body text-sm leading-relaxed text-text-low">
              Recomendado se este número também é pessoal: família, amigos e contatos antigos não
              recebem resposta automática.
            </p>
          </div>
          <div className="shrink-0 pt-0.5">
            <ReadOnlyGuard>
              <Toggle
                checked={locked && !confirmingOff}
                onChange={onToggle}
                label={SWITCH_TITLE}
                loading={update.isPending}
              />
            </ReadOnlyGuard>
          </div>
        </div>

        <div className="border-t border-border px-5 py-4">
          {locked ? (
            <ul className="flex flex-col gap-2 font-body text-sm text-text-mid">
              <li className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-pill bg-success" />
                Anúncio, botão do site e Direct do Instagram: a IA atende.
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-pill bg-text-low" />
                Qualquer outra conversa: a IA só atende se alguém da equipe ligar a IA na própria
                conversa.
              </li>
            </ul>
          ) : (
            <p className="flex gap-2 font-body text-sm text-text-mid">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-pill bg-warn" />
              Trava desligada: qualquer pessoa que escrever para este número pode receber resposta
              da IA, inclusive conversas antigas.
            </p>
          )}
        </div>

        {confirmingOff && (
          <div
            role="alertdialog"
            aria-labelledby="ai-origin-lock-confirm"
            className="mx-5 mb-5 rounded-md border border-warn/30 bg-warn/10 p-4 motion-safe:animate-[hm-rise_200ms_var(--ease)_both]"
          >
            <p id="ai-origin-lock-confirm" className="font-body text-sm font-bold text-text">
              Desligar a trava?
            </p>
            <p className="mt-1 font-body text-sm leading-relaxed text-text-mid">
              A partir de agora, fluxos, campanhas e retomadas podem ligar a IA em qualquer
              conversa, inclusive de contatos pessoais. Faça isso só se este número for usado
              apenas para o negócio.
            </p>
            <div className="mt-3 flex gap-2">
              <ReadOnlyGuard align="start">
                <Button variant="danger" size="sm" loading={update.isPending} onClick={() => void apply(false)}>
                  Desligar a trava
                </Button>
              </ReadOnlyGuard>
              <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => setConfirmingOff(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <footer className="flex flex-col gap-1 font-body text-sm text-text-low">
        <p>{describeLastChange(query.data.lastChange)}</p>
        <p>
          Religar a trava vale a partir da próxima mensagem, inclusive nas conversas em que a IA já
          está ligada. Só proprietários e administradores alteram, e toda mudança fica na
          Auditoria.
        </p>
      </footer>
    </div>
  );
}
