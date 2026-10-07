'use client';

import type { ReactNode } from 'react';
import { Ban, BellOff, CircleAlert, Clock, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import {
  restrictionCopy,
  untilLine,
  type BlockingReason,
  type ComposerGate,
  type RestrictionTone,
} from './sendRestriction';

type BlockedGate = Extract<ComposerGate, { kind: 'blocked' }>;

const TONE_SURFACE: Readonly<Record<RestrictionTone, string>> = {
  neutral: 'border-border-2 bg-surface-2',
  warn: 'border-warn bg-[var(--warn-bg)]',
  info: 'border-info bg-[var(--info-bg)]',
};

const TONE_ICON: Readonly<Record<RestrictionTone, string>> = {
  neutral: 'text-text-mid',
  warn: 'text-warn',
  info: 'text-info',
};

function reasonIcon(reason: BlockingReason | null, className: string): ReactNode {
  switch (reason) {
    case 'suppressed':
      return <BellOff className={className} aria-hidden />;
    case 'quiet_hours':
      return <Clock className={className} aria-hidden />;
    case 'registration_pending':
    case 'channel_disabled':
      return <Settings2 className={className} aria-hidden />;
    case 'no_consent':
    case null:
      return <Ban className={className} aria-hidden />;
  }
}

export interface RestrictionNoticeProps {
  gate: BlockedGate;
  className?: string;
}

/**
 * Aviso do portão de consentimento acima do composer (F60-S11).
 *
 * Responde as três perguntas do atendente: o que aconteceu (título), por quê (a
 * frase da API + a confirmação de que é regra, não defeito) e quando volta a
 * poder (`retryAt` formatado, ou a condição que libera).
 *
 * Contato suprimido usa tom NEUTRO de propósito: é o sistema funcionando, não
 * erro nem alerta — vermelho faria o atendente abrir chamado.
 */
export function RestrictionNotice({ gate, className }: RestrictionNoticeProps) {
  const copy = restrictionCopy(gate.reason);
  const until = untilLine(gate);
  const detail = gate.message.trim();

  return (
    <div
      role="status"
      data-restriction={gate.reason ?? 'unspecified'}
      className={cn(
        'mb-2 flex items-start gap-3 rounded-md border p-3',
        TONE_SURFACE[copy.tone],
        className,
      )}
    >
      {reasonIcon(gate.reason, cn('mt-0.5 size-4 shrink-0', TONE_ICON[copy.tone]))}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-body text-sm font-medium text-text">{copy.title}</p>
        {detail.length > 0 && <p className="font-body text-xs text-text-mid">{detail}</p>}
        <p className="font-body text-xs text-text-low">{copy.reassurance}</p>
        <p className="flex items-center gap-1.5 pt-0.5 font-body text-xs font-medium text-text">
          <Clock className="size-3.5 shrink-0 text-text-mid" aria-hidden />
          <span>{until}</span>
        </p>
      </div>
    </div>
  );
}

export interface RestrictionCheckErrorProps {
  onRetry: () => void;
  retrying: boolean;
  className?: string;
}

/**
 * Falha ao consultar a restrição (erro ≠ ausência). Não trava o composer: a API
 * confere de novo no envio e é a autoridade final. Mas também não finge que está
 * tudo liberado — diz o que falhou e oferece tentar de novo.
 */
export function RestrictionCheckError({
  onRetry,
  retrying,
  className,
}: RestrictionCheckErrorProps) {
  return (
    <div
      role="status"
      className={cn(
        'mb-2 flex items-start gap-3 rounded-md border border-border-2 bg-surface-2 p-3',
        className,
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-text-mid" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-body text-sm font-medium text-text">
          Não foi possível conferir se o envio está liberado
        </p>
        <p className="font-body text-xs text-text-mid">
          Você ainda pode escrever: o sistema confere as regras do canal na hora de enviar e avisa
          se recusar.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        aria-busy={retrying || undefined}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-sm border border-border-2 px-3 py-1.5 font-body text-xs font-medium text-text outline-none transition-colors',
          'hover:bg-surface-3 focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {retrying ? (
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <RefreshCw className="size-3.5" aria-hidden />
        )}
        Tentar de novo
      </button>
    </div>
  );
}
