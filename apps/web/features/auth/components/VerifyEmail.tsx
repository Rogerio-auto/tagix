'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useVerifyEmail } from '../queries';

type Phase = 'verifying' | 'success' | 'error' | 'missing';

/**
 * Confirma o email a partir do `?token=` do link (F44-S04 POST /auth/verify).
 * Sucesso → CTA para o login (NÃO faz auto-login). Token ausente/ inválido →
 * mensagem uniforme. Idempotente: roda uma vez por token.
 */
export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token') ?? params.get('token_hash') ?? '';
  const verify = useVerifyEmail();
  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'missing');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    verify
      .mutateAsync(token)
      .then(() => setPhase('success'))
      .catch(() => setPhase('error'));
  }, [token, verify]);

  if (phase === 'verifying') {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-4">
        <Loader2 className="size-5 animate-spin text-brand" aria-hidden />
        <p className="font-body text-text-mid">Confirmando seu email…</p>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-head text-sm font-semibold text-text">Email confirmado</p>
            <p className="font-body text-sm text-text-mid">
              Sua conta está ativa. Faça login para entrar no Leadium.
            </p>
          </div>
        </div>
        <Link
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-brand px-4 font-head text-sm font-semibold text-on-brand outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  // 'error' | 'missing' — mensagem uniforme (não revela o motivo exato).
  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <p className="font-head text-sm font-semibold text-text">Link inválido ou expirado</p>
          <p className="font-body text-sm text-text-mid">
            O link de confirmação não pôde ser validado. Faça login para reenviar a confirmação.
          </p>
        </div>
      </div>
      <Link
        href="/login"
        className="touch-target flex items-center justify-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
      >
        Voltar ao login
      </Link>
    </div>
  );
}
