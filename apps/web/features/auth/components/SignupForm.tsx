'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, AlertTriangle, MailCheck } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { signupSchema, type SignupInput } from '../schema';
import { useSignup } from '../queries';
import { rememberSignupEmail } from '../pending-email';
import { TERMS_VERSION } from '../terms';
import { RESEND_COOLDOWN_SECONDS } from '../resend';
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
      <div className="flex flex-col gap-5">
        <div role="status" className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-head text-sm font-semibold text-text">Verifique seu email</p>
            <p className="font-body text-sm text-text-mid">
              Se os dados estiverem corretos, enviamos um link de confirmação para{' '}
              <span className="font-medium text-text wrap-anywhere">{sentTo}</span>. Abra-o para ativar
              sua conta: você só acessa o Leadium depois de confirmar.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-body text-sm text-text-mid">Não chegou? Confira o spam ou reenvie.</p>
          <ResendVerification email={sentTo} initialCooldownSeconds={RESEND_COOLDOWN_SECONDS} />
        </div>
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="touch-target flex items-center justify-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
          >
            Errei o email — voltar ao cadastro
          </button>
          <Link
            href={`/login?email=${encodeURIComponent(sentTo)}`}
            className="touch-target flex items-center justify-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
          >
            Voltar ao login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {planLabel && plan !== 'free' && (
        <div className="flex items-center gap-2 rounded-md border border-brand/40 bg-brand/5 p-3">
          <p className="font-body text-sm text-text-mid">
            Plano escolhido: <span className="font-head font-semibold text-text">{planLabel}</span>.
            Crie sua conta — você vai para o pagamento depois de confirmar o email.
          </p>
        </div>
      )}
      {submitError && (
        <div
          role="alert"
          className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="font-head text-sm font-semibold text-text">{submitError.title}</p>
            <p className="font-body text-sm text-text-mid">{submitError.description}</p>
          </div>
        </div>
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
        <label className="flex cursor-pointer items-start gap-3 py-1">
          <input
            type="checkbox"
            aria-invalid={errors.acceptTerms ? true : undefined}
            aria-describedby={errors.acceptTerms ? 'accept-terms-error' : undefined}
            className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-xs accent-text outline-none focus-visible:shadow-glow-md"
            {...register('acceptTerms')}
          />
          <span className="font-body text-sm text-text-mid">
            Li e aceito os{' '}
            <Link
              href="/termos"
              target="_blank"
              rel="noopener"
              className="font-medium text-text underline underline-offset-4 outline-none hover:text-brand focus-visible:shadow-glow-md"
            >
              Termos de uso
            </Link>{' '}
            e a{' '}
            <Link
              href="/privacidade"
              target="_blank"
              rel="noopener"
              className="font-medium text-text underline underline-offset-4 outline-none hover:text-brand focus-visible:shadow-glow-md"
            >
              Política de privacidade
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms && (
          // Ícone em `danger`, texto em `text`: `text-danger` a 14 px dá 3:1 no tema claro.
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
      <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
        Criar conta
      </Button>
      <Link
        href="/login"
        className="touch-target flex items-center justify-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
      >
        Já tenho conta — entrar
      </Link>
    </form>
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
