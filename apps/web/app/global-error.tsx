'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { captureException } from '@/shared/lib/sentry/capture';
import './globals.css';

/**
 * Error boundary GLOBAL do App Router (Next 15). Só dispara quando o erro
 * acontece no próprio root layout — por isso ele renderiza o seu próprio
 * `<html>`/`<body>`, substituindo a árvore inteira.
 *
 * UX §2.11 (erro-misterioso → mensagem humana): título do QUÊ, frase do que
 * fazer, e ação de retry (`reset`). Dark-first, tokens semânticos, zero hex.
 * Reporta ao Sentry (no-op sem DSN).
 */

// Mesmo guard de tema do root layout: evita flash de tema errado quando o
// layout falhou e este boundary assume a árvore (DESIGN_SYSTEM §9.4).
const themeScript = `(function(){try{var s=localStorage.getItem('hm:theme');var t=s||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <main className="flex min-h-dvh items-center justify-center bg-surface px-6 py-16">
          <div
            role="alert"
            className="mx-auto flex max-w-md flex-col items-center gap-4 text-center"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-danger">
              <AlertTriangle className="size-7" aria-hidden />
            </span>
            <h1 className="font-head text-2xl font-semibold text-text">
              Algo saiu do esperado
            </h1>
            <p className="font-body text-text-mid">
              Tivemos um problema ao carregar esta tela. Não é você — já registramos o
              ocorrido e vamos investigar.
            </p>
            <p className="font-body text-sm text-text-low">
              Tente novamente. Se persistir, recarregue a página ou volte mais tarde.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-surface-2 px-4 font-head text-sm font-semibold text-text outline-none transition-[color,background-color,box-shadow] duration-200 ease-out hover:bg-surface-3 focus-visible:shadow-glow-md active:scale-[0.98]"
            >
              <RotateCcw className="size-4" aria-hidden />
              Tentar de novo
            </button>
            {error.digest && (
              <p className="mt-1 font-price text-xs text-text-low">Ref: {error.digest}</p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
