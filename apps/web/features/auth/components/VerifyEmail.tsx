'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Input } from '@hm/ui';
import { useVerifyEmail } from '../queries';
import { forgetSignupEmail, readSignupEmail } from '../pending-email';
import { isValidEmail, sanitizeEmailParam } from '../resend';
import { AuthHeading, AuthNotice, primaryLinkClass, quietLinkClass } from './AuthKit';
import { ResendVerification } from './ResendVerification';

type Phase = 'verifying' | 'success' | 'error' | 'missing';

/**
 * Link inválido/expirado: nunca um beco. Explica e oferece o próximo passo ali mesmo,
 * um campo de email + "Reenviar" (Turnstile, 60 s, resposta uniforme), além do login.
 */
export function ExpiredLinkRecovery({
  initialEmail = '',
  missing = false,
}: {
  initialEmail?: string;
  /** Sem `?token=` na URL (link cortado/aberto à mão) em vez de token recusado. */
  missing?: boolean;
}) {
  const [email, setEmail] = useState(initialEmail);
  // Preenchido depois da hidratação (o email lembrado vem do navegador).
  useEffect(() => {
    if (initialEmail === '') {
      const remembered = sanitizeEmailParam(readSignupEmail());
      if (remembered) setEmail((current) => (current === '' ? remembered : current));
    }
  }, [initialEmail]);

  return (
    <>
      {/* O título É o estado (F71-S09): quem chega por um link velho lê o problema no H1. */}
      <AuthHeading
        eyebrow="Confirmação de email"
        title={missing ? 'Link incompleto' : 'Link inválido ou expirado'}
        lead={
          missing
            ? 'O endereço não traz o código de confirmação. Peça um novo email abaixo.'
            : 'Cada link de confirmação vale por pouco tempo e só uma vez. Peça um novo abaixo.'
        }
        focusOnMount={!missing}
      />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Input
            label="Email da sua conta"
            type="email"
            size="lg"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="voce@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={email !== '' && !isValidEmail(email) ? 'Email inválido' : undefined}
          />
          <ResendVerification email={email} />
        </div>
        <div className="flex justify-center border-t border-border pt-3">
          <Link
            href={email && isValidEmail(email) ? `/login?email=${encodeURIComponent(email)}` : '/login'}
            className={quietLinkClass}
          >
            Já confirmei — ir para o login
          </Link>
        </div>
      </div>
    </>
  );
}

/** Sucesso: "Email confirmado" + CTA para o login já com o email (quando conhecido). */
export function VerifiedSuccess({ email = '' }: { email?: string }) {
  const params = new URLSearchParams();
  if (email) params.set('email', email);
  params.set('from', 'verify');
  return (
    <>
      <AuthHeading
        eyebrow="Confirmação de email"
        title="Email confirmado"
        lead="Sua conta está ativa. Entre com a sua senha para começar."
        focusOnMount
      />
      <div role="status" className="flex flex-col gap-5">
        <AuthNotice tone="success" icon={<CheckCircle2 aria-hidden />} title="Conta ativada">
          {email ? (
            <>
              Acesso liberado para <span className="font-mono text-text wrap-anywhere">{email}</span>.
            </>
          ) : (
            'Acesso liberado.'
          )}
        </AuthNotice>
        <Link href={`/login?${params.toString()}`} className={primaryLinkClass}>
          Ir para o login
        </Link>
      </div>
    </>
  );
}
/**
 * Confirma o email a partir do `?token=` do link (F44-S04 POST /auth/verify).
 * Sucesso → CTA para o login (NÃO faz auto-login). Token ausente/inválido →
 * recuperação com reenvio (F71-S09). Idempotente: roda uma vez por token.
 */
export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token') ?? params.get('token_hash') ?? '';
  const emailParam = sanitizeEmailParam(params.get('email'));
  const verify = useVerifyEmail();
  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : 'missing');
  const [knownEmail, setKnownEmail] = useState(emailParam);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    verify
      .mutateAsync(token)
      .then(() => {
        // O link não carrega o email; o cadastro deste navegador o lembrou.
        const remembered = emailParam || sanitizeEmailParam(readSignupEmail());
        setKnownEmail(remembered);
        forgetSignupEmail();
        setPhase('success');
      })
      .catch(() => setPhase('error'));
  }, [token, verify, emailParam]);

  if (phase === 'verifying') {
    return (
      <>
        <AuthHeading
          eyebrow="Confirmação de email"
          title="Confirmando seu email"
          lead="Isso leva só um instante."
        />
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3.5"
        >
          <Loader2 className="size-5 animate-spin text-text-mid motion-reduce:animate-none" aria-hidden />
          <p className="font-body text-sm text-text-mid">Validando o link de confirmação…</p>
        </div>
      </>
    );
  }

  if (phase === 'success') return <VerifiedSuccess email={knownEmail} />;

  return <ExpiredLinkRecovery initialEmail={emailParam} missing={phase === 'missing'} />;
}
