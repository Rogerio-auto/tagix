import { Suspense } from 'react';
import { AuthHeading } from '@/features/auth/components/AuthKit';
import { VerifyEmail } from '@/features/auth/components/VerifyEmail';

/**
 * O título acompanha a fase da verificação e mora no `VerifyEmail` (confirmando,
 * confirmado, link expirado ou incompleto). O fallback do Suspense já tem o seu H1.
 */
export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <AuthHeading
          eyebrow="Confirmação de email"
          title="Confirmando seu email"
          lead="Isso leva só um instante."
        />
      }
    >
      <VerifyEmail />
    </Suspense>
  );
}
