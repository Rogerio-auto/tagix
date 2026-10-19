'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Clock, MailWarning, UserCheck } from 'lucide-react';
import { Button, Input, cn } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthCompanion, useAuthCompanionStep } from '@/features/auth/companion';
import { postLoginPath } from '@/shared/auth/route-guard';
import { loginSchema, type LoginInput } from '../schema';
import { useLogin } from '../queries';
import { LOGIN_NOTICE_COPY, type LoginNotice } from '../resend';
import { AuthNotice, inlineLinkClass, quietLinkClass } from './AuthKit';
import { ResendVerification } from './ResendVerification';

/** Erro de submit em 3 partes (UX §2.11): o quê / por quê / o que fazer. */
interface SubmitError {
  title: string;
  description: string;
}

export interface LoginFormProps {
  /**
   * A pessoa chegou aqui porque a sessão terminou (`?motivo=sessao-expirada`, F70-S28).
   * Mostra o aviso ANTES do formulário: sem ele, cair no login do nada parece bug.
   */
  sessionExpired?: boolean;
  /** Email vindo de `?email=` (convite aceito, email confirmado): pré-preenche o campo. */
  initialEmail?: string;
  /** Aviso de boas-vindas conforme a origem (`?from=`); ver `loginNoticeFor`. */
  notice?: LoginNotice;
}

/**
 * 403 `email_unverified` (F71-S04): a senha estava certa, falta confirmar o email.
 * Não é "erro de credencial": explica e dá a saída ali mesmo (reenviar), com o email
 * que a pessoa já digitou — sem voltar a outra tela.
 */
export function UnverifiedPanel({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/10 p-4">
      <div role="alert" className="flex gap-3">
        <MailWarning className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-body text-sm font-bold text-text">Confirme seu email para entrar.</p>
          <p className="font-body text-sm text-text-mid">
            Enviamos um link quando você criou a conta. Abra-o e volte aqui, ou peça um novo.
          </p>
        </div>
      </div>
      <ResendVerification email={email} idleLabel="Reenviar confirmação" />
    </div>
  );
}

export function LoginForm({
  sessionExpired = false,
  initialEmail = '',
  notice = null,
}: LoginFormProps) {
  const router = useRouter();
  const login = useLogin();
  // Companheiro: só SINAIS (etapa, envio, resultado). Nenhum valor de campo passa por aqui.
  useAuthCompanionStep('login');
  const companion = useAuthCompanion();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [unverified, setUnverified] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: initialEmail },
  });
  const typedEmail = watch('email') ?? '';

  // Email já conhecido (convite/confirmação): o próximo passo é a senha.
  useEffect(() => {
    if (initialEmail) setFocus('password');
  }, [initialEmail, setFocus]);

  const onValid = async (data: LoginInput) => {
    setSubmitError(null);
    setUnverified(false);
    companion.signal({ type: 'submit' });
    try {
      const res = await login.mutateAsync(data);
      // Sucesso: celebra e navega NO MESMO tick (sem retenção artificial do redirect).
      companion.signal({ type: 'success', final: false });
      // Intenção de plano da venda: se o cadastro escolheu um plano pago, o login o
      // entrega ao checkout (plano pré-selecionado). Tem prioridade sobre o ?next=.
      if (res.pendingPlanKey) {
        router.push(`/settings/billing?plan=${encodeURIComponent(res.pendingPlanKey)}`);
        router.refresh();
        return;
      }
      // Open-redirect guard (T11): lê ?next= do location (client-only, sem Suspense)
      // e só permite caminho interno same-origin que não seja outra tela pública.
      const rawNext =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('next')
          : null;
      router.push(postLoginPath(rawNext));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.code === 'email_unverified') {
        // Não é erro de credencial: a senha estava certa e o painel próprio explica.
        companion.signal({ type: 'settled' });
        setUnverified(true);
        return;
      }
      // UX §2.11: erro com o quê / por quê / o que fazer. Só inline (role=alert): no
      // mobile o toast fica atrás do teclado, e os dois juntos anunciavam o erro duas
      // vezes no leitor de tela.
      const isBadCreds = err instanceof ApiError && err.status === 401;
      companion.signal({ type: 'error', kind: isBadCreds ? 'credentials' : 'server' });
      const nextError: SubmitError = isBadCreds
        ? {
            title: 'Email ou senha incorretos',
            description: 'Confira os dados e tente de novo, ou redefina sua senha.',
          }
        : {
            title: 'Não foi possível entrar',
            description: 'Algo deu errado ao autenticar. Tente novamente em instantes.',
          };
      setSubmitError(nextError);
    }
  };
  const onSubmit = handleSubmit(onValid, () =>
    companion.signal({ type: 'error', kind: 'validation' }),
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {notice && !sessionExpired && !submitError && !unverified && (
        <AuthNotice role="status" tone="success" icon={<UserCheck aria-hidden />} title={LOGIN_NOTICE_COPY[notice]} />
      )}
      {unverified && <UnverifiedPanel email={typedEmail} />}
      {sessionExpired && !submitError && !unverified && (
        <AuthNotice
          role="status"
          tone="info"
          icon={<Clock aria-hidden />}
          title="Sua sessão terminou. Entre de novo."
        >
          Por segurança, o acesso expira depois de um tempo. Você volta para onde estava.
        </AuthNotice>
      )}
      {submitError && (
        <AuthNotice role="alert" tone="danger" icon={<AlertTriangle aria-hidden />} title={submitError.title}>
          {submitError.description}
        </AuthNotice>
      )}
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
      <div className="flex flex-col gap-1">
        <Input
          label="Senha"
          type="password"
          size="lg"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="••••••••"
          error={errors.password?.message}
          {...register('password')}
        />
        <Link href="/reset-password" className={cn(quietLinkClass, '-mr-2 self-end')}>
          Esqueci minha senha
        </Link>
      </div>
      <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
        Entrar
      </Button>
      <p className="border-t border-border pt-5 text-center font-body text-sm text-text-mid">
        Não tem conta?{' '}
        <Link href="/signup" className={inlineLinkClass}>
          Criar conta
        </Link>
      </p>
    </form>
  );
}
