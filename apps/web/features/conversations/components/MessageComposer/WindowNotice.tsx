'use client';

import { Info, Lock } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { WindowState } from './useWindowState';

export interface WindowNoticeProps {
  window: WindowState;
  /** Dispara o fluxo de reabrir com template (WhatsApp). */
  onReopenWithTemplate?: () => void;
  className?: string;
}

/**
 * Aviso de janela 24h acima do composer (F1-S17).
 *
 *  - WhatsApp fora da janela (`requiresTemplate`): superfície de bloqueio com
 *    CTA "Reabrir com template" — o composer abaixo fica desabilitado.
 *  - Instagram fora da janela (`messageTag === 'HUMAN_AGENT'`): banner
 *    informativo de Human Agent Tag — o envio segue liberado, mas marcado.
 *
 * Acessível: `role` adequado (`alert` para bloqueio, `status` para banner),
 * foco visível no CTA, tokens semânticos (sem hex hardcoded).
 */
export function WindowNotice({ window, onReopenWithTemplate, className }: WindowNoticeProps) {
  // WhatsApp: bloqueio com CTA de template.
  if (window.requiresTemplate) {
    return (
      <div
        role="alert"
        className={cn(
          'mb-2 flex items-start gap-3 rounded-md border border-warn bg-[var(--warn-bg)] p-3',
          className,
        )}
      >
        <Lock className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-body text-sm font-medium text-text">
            Janela de 24h encerrada
          </p>
          <p className="font-body text-xs text-text-mid">
            O contato não interage há mais de 24 horas. Para retomar, reabra a conversa com um
            template aprovado.
          </p>
        </div>
        <button
          type="button"
          onClick={onReopenWithTemplate}
          className={cn(
            'shrink-0 rounded-sm border border-warn px-3 py-1.5 font-body text-xs font-medium text-warn outline-none transition-colors',
            'hover:bg-warn hover:text-text-on-brand focus-visible:shadow-glow-md',
          )}
        >
          Reabrir com template
        </button>
      </div>
    );
  }

  // Instagram: banner Human Agent Tag (envio liberado, marcado).
  if (window.messageTag === 'HUMAN_AGENT') {
    return (
      <div
        role="status"
        className={cn(
          'mb-2 flex items-start gap-3 rounded-md border border-info bg-[var(--info-bg)] p-3',
          className,
        )}
      >
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-body text-sm font-medium text-text">Human Agent Tag</p>
          <p className="font-body text-xs text-text-mid">
            Fora da janela de 24h. Esta resposta será enviada com a tag de atendimento humano e
            registrada para auditoria.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
