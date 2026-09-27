'use client';

/**
 * Configurações → IA: trava de origem do workspace (F70-S30).
 *
 * Um interruptor decide se a IA automática só atende quem chegou por anúncio, site ou
 * Instagram (ligada, padrão) ou qualquer conversa (desligada). Ligar aplica na hora;
 * desligar pede confirmação, porque abre a IA para contatos pessoais do número. O
 * servidor restringe a OWNER/ADMIN e audita cada mudança; a seção só aparece para quem
 * tem `workspace.edit`.
 */
import { useState } from 'react';
import { Button, ErrorState, Skeleton, useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { Toggle } from '../personal/components';
import { useAiOriginLock, useSetAiOriginLock, type AiOriginLockLastChange } from './queries';

const SWITCH_TITLE = 'Responder só quem chegou por anúncio, site ou Instagram';

// Idioma do navegador (sem literal de locale no componente; o market pack não chega aqui).
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function describeLastChange(change: AiOriginLockLastChange | null): string {
  if (change === null) return 'Nunca alterada. Todo workspace começa com a trava ligada.';
  const who = change.byName ?? change.byEmail ?? 'Um membro que saiu do workspace';
  const what = change.next ? 'ligou' : 'desligou';
  const when = dateFormat.format(new Date(change.at));
  return `${who} ${what} a trava em ${when}.`;
}

export default function AiOriginLockSection(): React.JSX.Element {
  const { toast } = useToast();
  const query = useAiOriginLock();
  const update = useSetAiOriginLock();
  const [confirmingOff, setConfirmingOff] = useState(false);

  if (query.isLoading) {
    return (
      <div className="flex max-w-2xl flex-col gap-4" aria-busy="true">
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
          <Button variant="secondary" onClick={() => void query.refetch()}>
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
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-text-low">
          Atendimento automático
        </p>
        <h2 className="text-lg font-semibold text-text">Quem a IA pode atender</h2>
        <p className="text-sm leading-relaxed text-text-mid">
          A IA responde sozinha quando um fluxo, uma campanha ou uma retomada a liga numa
          conversa. Esta trava decide se ela pode fazer isso com qualquer pessoa ou só com quem
          chegou por um caminho comprovado.
        </p>
      </header>

      <section
        aria-labelledby="ai-origin-lock-title"
        className={cn(
          'rounded-xl border bg-surface p-5 transition-colors',
          locked ? 'border-border' : 'border-warning/30',
        )}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p id="ai-origin-lock-title" className="text-sm font-medium text-text">
              {SWITCH_TITLE}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-low">
              Recomendado se este número também é pessoal: família, amigos e contatos antigos não
              recebem resposta automática.
            </p>
          </div>
          <div className="shrink-0 pt-0.5">
            <Toggle
              checked={locked && !confirmingOff}
              onChange={onToggle}
              label={SWITCH_TITLE}
              disabled={update.isPending}
            />
          </div>
        </div>

        <div className="mt-5 border-t border-border/40 pt-4">
          {locked ? (
            <ul className="flex flex-col gap-2 text-sm text-text-mid">
              <li className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />
                Anúncio, botão do site e Direct do Instagram: a IA atende.
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-text-low" />
                Qualquer outra conversa: a IA só atende se alguém da equipe ligar a IA na própria
                conversa.
              </li>
            </ul>
          ) : (
            <p className="flex gap-2 text-sm text-text-mid">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
              Trava desligada: qualquer pessoa que escrever para este número pode receber resposta
              da IA, inclusive conversas antigas.
            </p>
          )}
        </div>

        {confirmingOff && (
          <div
            role="alertdialog"
            aria-labelledby="ai-origin-lock-confirm"
            className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-4"
          >
            <p id="ai-origin-lock-confirm" className="text-sm font-medium text-text">
              Desligar a trava?
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-mid">
              A partir de agora, fluxos, campanhas e retomadas podem ligar a IA em qualquer
              conversa, inclusive de contatos pessoais. Faça isso só se este número for usado
              apenas para o negócio.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="danger"
                size="sm"
                loading={update.isPending}
                onClick={() => void apply(false)}
              >
                Desligar a trava
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                onClick={() => setConfirmingOff(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </section>

      <footer className="flex flex-col gap-1 text-xs text-text-low">
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
