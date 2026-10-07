import { Suspense } from 'react';
import { VerifyEmail } from '@/features/auth/components/VerifyEmail';

export default function VerifyPage() {
  return (
    <div className="mx-auto w-full max-w-sm py-8 md:py-0">
      <div className="mb-8 flex items-center gap-2">
        <span className="font-display text-2xl text-brand" aria-hidden>
          ◢
        </span>
        <span className="font-head text-2xl font-semibold text-text">Leadium</span>
      </div>
      <h1 className="mb-1 font-head text-3xl font-semibold text-text">Confirmação de email</h1>
      <p className="mb-6 font-body text-text-mid">Ative sua conta pelo link que enviamos ao seu email.</p>
      <Suspense fallback={<p className="font-body text-text-mid">Carregando…</p>}>
        <VerifyEmail />
      </Suspense>
    </div>
  );
}
