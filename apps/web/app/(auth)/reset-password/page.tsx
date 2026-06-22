'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';
import { NewPasswordForm } from '@/features/auth/components/NewPasswordForm';

/**
 * Tela de redefinição de senha (Leadium). Dois modos:
 *  - sem token: pede o email (envia o link) — fluxo de SOLICITAÇÃO.
 *  - com `?token=` (alvo do link de recuperação): define a NOVA senha.
 */
function ResetPasswordInner() {
  const params = useSearchParams();
  const hasToken = Boolean(params.get('token') ?? params.get('token_hash'));

  return (
    <div className="mx-auto w-full max-w-sm py-8 md:py-0">
      <div className="mb-8 flex items-center gap-2">
        <span className="font-display text-2xl text-brand" aria-hidden>
          ◢
        </span>
        <span className="font-head text-2xl font-semibold text-text">Leadium</span>
      </div>
      <h1 className="mb-1 font-head text-3xl font-semibold text-text">
        {hasToken ? 'Definir nova senha' : 'Redefinir senha'}
      </h1>
      <p className="mb-6 font-body text-text-mid">
        {hasToken
          ? 'Escolha uma nova senha para a sua conta.'
          : 'Informe seu email e enviaremos as instruções.'}
      </p>
      {hasToken ? <NewPasswordForm /> : <ResetPasswordForm />}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-sm py-8 font-body text-text-mid">Carregando…</p>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
