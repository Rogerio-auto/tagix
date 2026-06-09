'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';

export interface ErrorStateProps {
  /** O QUÊ aconteceu (UX §2.11). Ex.: "Falha ao enviar mensagem". */
  title: string;
  /** POR QUÊ, em linguagem simples. Ex.: "Janela de 24h da Meta fechou". */
  reason?: string;
  /** O QUE FAZER. Ex.: "Use um template aprovado para reabrir a conversa." */
  whatToDo?: string;
  /** Ref técnica copiável (nunca stack trace). Ex.: "hm_err_abc123". */
  reference?: string;
  action?: ReactNode;
}

export function ErrorState({ title, reason, whatToDo, reference, action }: ErrorStateProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!reference) return;
    await navigator.clipboard.writeText(reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <AlertCircle className="size-12 text-danger" aria-hidden />
      <h2 className="font-head text-2xl font-semibold text-text">{title}</h2>
      {reason && <p className="font-body text-text-mid">{reason}</p>}
      {whatToDo && <p className="font-body text-sm text-text-low">{whatToDo}</p>}
      {action && <div className="mt-2">{action}</div>}
      {reference && (
        <button
          type="button"
          onClick={copy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-price text-xs text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          Ref: {reference}
        </button>
      )}
    </div>
  );
}
