'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthHeading } from '@/features/auth/components/AuthKit';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';
import { NewPasswordForm } from '@/features/auth/components/NewPasswordForm';

/**
 * Tela de redefinição de senha (Leadium). Dois modos:
 *  - sem token: pede o email (envia o link) — fluxo de SOLICITAÇÃO.
 *  - com `?token=` (alvo do link de recuperação): define a NOVA senha.
 *
 * O título mora em cada formulário e acompanha o estado (enviado, link inválido,
 * senha redefinida), como no cadastro.
 */
function ResetPasswordInner() {
  const params = useSearchParams();
  const hasToken = Boolean(params.get('token') ?? params.get('token_hash'));
  return hasToken ? <NewPasswordForm /> : <ResetPasswordForm />;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthHeading eyebrow="Recuperação de acesso" title="Redefinir senha" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
