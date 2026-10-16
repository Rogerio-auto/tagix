'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, AlertTriangle, MailCheck, Sparkles } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { signupSchema, type SignupInput } from '../schema';
import { useSignup } from '../queries';
import { rememberSignupEmail } from '../pending-email';
import { TERMS_VERSION } from '../terms';
import { RESEND_COOLDOWN_SECONDS } from '../resend';
import { AuthHeading, AuthNotice, inlineLinkClass, quietLinkClass } from './AuthKit';
import { ResendVerification } from './ResendVerification';
import { TurnstileWidget } from './TurnstileWidget';

/** UX §2.11: erro em 3 partes. */
interface SubmitError {
  title: string;
  description: string;
}

/** Rótulos amigáveis das keys de plano da página de venda (?plan=). */
const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
};

export function SignupForm() {
  const signup = useSignup();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  // Email para o qual o link saiu (null = ainda no formulário).
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [token, setToken] = useState('');
  // Plano vindo da página de venda (?plan=). Client-only, sem Suspense (mesmo
  // padrão do ?next= no login). A API revalida — aqui é só intenção/exibição.
  const [plan] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('plan') ?? '').trim().toLowerCase();
  });
  const planLabel = PLAN_LABELS[plan];
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { acceptTerms: false },
  });

  const onToken = useCallback((t: string) => setToken(t), []);
  const password = watch('password') ?? '';

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(null);
    if (!token) {
      setSubmitError({
        title: 'Confirme que você não é um robô',
        description: 'Complete a verificação anti-robô antes de continuar.',
      });
      return;
    }
    try {
      await signup.mutateAsync({
        ...data,
        acceptTerms: true,
        termsVersion: TERMS_VERSION,
        turnstileToken: token,
        plan: plan || undefined,
      });
      // Resposta uniforme — sucesso = "verifique seu email" (sem auto-login).
      rememberSignupEmail(data.email);
      setSentTo(data.email);
    } catch {
      setSubmitError({
        title: 'Não foi possível criar a conta',
        description: 'Algo deu errado. Recarregue a página e tente novamente.',
      });
    }
  });

  if (sentTo !== null) {
    return (
      <>
        {/* O título acompanha o estado (ressalva da F71-S09): a tela agora é outra. */}
        <AuthHeading
          eyebrow="Confirmação"
          title="Verifique seu email"
          lead="Falta um passo para ativar a sua conta."
          focusOnMount
        />
        <div className="flex flex-col gap-5">
          <AuthNotice role="status" tone="neutral" icon={<MailCheck aria-hidden />}>
            Se os dados estiverem corretos, enviamos um link de confirmação para{' '}
            <span className="font-mono text-text wrap-anywhere">{sentTo}</span>. Abra-o para ativar
            sua conta: você só acessa o Leadium depois de confirmar.
          </AuthNotice>
          <div className="flex flex-col gap-3">
            <p className="font-body text-sm text-text-mid">Não chegou? Confira o spam ou reenvie.</p>
            <ResendVerification email={sentTo} initialCooldownSeconds={RESEND_COOLDOWN_SECONDS} />
          </div>
          <div className="flex flex-col items-center border-t border-border pt-3">
            <button type="button" onClick={() => setSentTo(null)} className={quietLinkClass}>
              Errei o email — voltar ao cadastro
            </button>
            <Link href={`/login?email=${encodeURIComponent(sentTo)}`} className={quietLinkClass}>
              Voltar ao login
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        eyebrow="Nova conta"
        title="Criar conta"
        lead="Comece em minutos. Sem cartão — plano gratuito para testar."
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {planLabel && plan !== 'free' && (
          <AuthNotice tone="neutral" icon={<Sparkles aria-hidden />} title={`Plano escolhido: ${planLabel}`}>
            Crie sua conta — você vai para o pagamento depois de confirmar o email.
          </AuthNotice>
        )}
        {submitError && (
          <AuthNotice role="alert" tone="danger" icon={<AlertTriangle aria-hidden />} title={submitError.title}>
            {submitError.description}
          </AuthNotice>
        )}
        <Input
          label="Seu nome"
          size="lg"
          autoComplete="name"
          placeholder="Maria Silva"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Email"
          type="email"
          size="lg"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="voce@empresa.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Nome do workspace"
          size="lg"
          autoComplete="organization"
          placeholder="Minha Empresa"
          error={errors.workspaceName?.message}
          {...register('workspaceName')}
        />
        <Input
          label="Senha"
          type="password"
          size="lg"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ao menos 10 caracteres"
          hint={
            password.length > 0 ? passwordHint(password) : 'Use letras e números, mín. 10 caracteres.'
          }
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-start gap-3 rounded-sm py-1">
            <input
              type="checkbox"
              aria-invalid={errors.acceptTerms ? true : undefined}
              aria-describedby={errors.acceptTerms ? 'accept-terms-error' : undefined}
              className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-xs accent-text outline-none focus-visible:focus-ring"
              {...register('acceptTerms')}
            />
            <span className="font-body text-sm text-text-mid">
              Li e aceito os{' '}
              <Link href="/termos" target="_blank" rel="noopener" className={inlineLinkClass}>
                Termos de uso
              </Link>{' '}
              e a{' '}
              <Link href="/privacidade" target="_blank" rel="noopener" className={inlineLinkClass}>
                Política de privacidade
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms && (
            // Ícone em `danger`, texto em `text`: o vermelho fica no sinal, a leitura no neutro.
            <span
              id="accept-terms-error"
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2 font-body text-sm text-text"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              {errors.acceptTerms.message}
            </span>
          )}
        </div>
        <TurnstileWidget onToken={onToken} />
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Criar conta
        </Button>
        <p className="border-t border-border pt-5 text-center font-body text-sm text-text-mid">
          Já tem conta?{' '}
          <Link href="/login" className={inlineLinkClass}>
            Entrar
          </Link>
        </p>
      </form>
    </>
  );
}

/** Dica leve de força de senha (sem barra colorida exagerada). */
function passwordHint(password: string): string {
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  if (password.length < 10 || !hasLetter || !hasNumber)
    return 'Senha fraca — combine letras e números.';
  if (password.length >= 14 && hasSymbol) return 'Senha forte.';
  return 'Senha boa.';
}
