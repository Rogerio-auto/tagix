'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';
import { describeApiError } from '@/shared/lib/api-error-message';

export interface ErrorStateProps {
  /**
   * Erro cru (`ApiError`/`Error`/`unknown`). Quando passado, `title`/`reason`/
   * `whatToDo`/`reference` são derivados por `describeApiError` (mapeia status →
   * mensagem humana + `ref`). Props explícitas têm prioridade sobre o derivado.
   */
  error?: unknown;
  /** O QUÊ aconteceu (UX §2.11). Ex.: "Falha ao enviar mensagem". */
  title?: string;
  /** POR QUÊ, em linguagem simples. Ex.: "Janela de 24h da Meta fechou". */
  reason?: string;
  /** O QUE FAZER. Ex.: "Use um template aprovado para reabrir a conversa." */
  whatToDo?: string;
  /** Ref técnica copiável (nunca stack trace). Ex.: "hm_err_abc123". */
  reference?: string;
  action?: ReactNode;
}

export function ErrorState({
  error,
  title,
  reason,
  whatToDo,
  reference,
  action,
}: ErrorStateProps) {
  const [copied, setCopied] = useState(false);

  // Deriva do erro quando fornecido; props explícitas sempre vencem o derivado.
  const derived = error !== undefined ? describeApiError(error) : undefined;
  const resolvedTitle = title ?? derived?.title ?? 'Não foi possível completar a ação';
  const resolvedReason = reason ?? derived?.reason;
  const resolvedWhatToDo = whatToDo ?? derived?.whatToDo;
  const resolvedRef = reference ?? derived?.reference;

  const copy = async () => {
    if (!resolvedRef) return;
    await navigator.clipboard.writeText(resolvedRef);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <AlertCircle className="size-12 text-danger" aria-hidden />
      <h2 className="font-head text-2xl font-semibold text-text">{resolvedTitle}</h2>
      {resolvedReason && <p className="font-body text-text-mid">{resolvedReason}</p>}
      {resolvedWhatToDo && <p className="font-body text-sm text-text-low">{resolvedWhatToDo}</p>}
      {action && <div className="mt-2">{action}</div>}
      {resolvedRef && (
        <button
          type="button"
          onClick={copy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-price text-xs text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          Ref: {resolvedRef}
        </button>
      )}
    </div>
  );
}
