'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';
import { cn } from '../lib/cn';

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** O QUÊ aconteceu (UX §2.11). Ex.: "Falha ao enviar mensagem". */
  title: ReactNode;
  /** POR QUÊ, em linguagem simples. Ex.: "A janela de 24h da Meta fechou". */
  reason?: ReactNode;
  /** O QUE FAZER. Ex.: "Use um template aprovado para reabrir a conversa." */
  whatToDo?: ReactNode;
  /** Ref técnica copiável (NUNCA stack trace). Ex.: "hm_err_abc123". */
  reference?: string;
  /** Ação de recuperação — normalmente `<Button>Tentar de novo</Button>`. */
  action?: ReactNode;
}

/**
 * Estado de erro em 3 partes (UX §2.11): o quê / por quê / o que fazer, com uma
 * referência copiável opcional para suporte. `role="alert"` para anúncio imediato.
 * Tokens semânticos, dark/light, zero hex.
 */
export function ErrorState({
  title,
  reason,
  whatToDo,
  reference,
  action,
  className,
  ...props
}: ErrorStateProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponível — falha silenciosa, a ref segue visível */
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      <span className="flex size-14 items-center justify-center rounded-pill border border-danger/25 bg-danger/10">
        <AlertCircle className="size-7 text-danger" aria-hidden strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-head text-xl font-semibold text-text">{title}</h2>
        {reason && <p className="font-body text-sm text-text-mid">{reason}</p>}
        {whatToDo && <p className="font-body text-sm text-text-low">{whatToDo}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
      {reference && (
        <button
          type="button"
          onClick={copy}
          className="mt-1 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-price text-xs text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copiado' : `Ref: ${reference}`}
        </button>
      )}
    </div>
  );
}
