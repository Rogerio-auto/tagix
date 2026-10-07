'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Clock, MailWarning, UserCheck } from 'lucide-react';
import { Button, Input, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { postLoginPath } from '@/shared/auth/route-guard';
import { loginSchema, type LoginInput } from '../schema';
import { useLogin } from '../queries';
import { LOGIN_NOTICE_COPY, type LoginNotice } from '../resend';
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
    <div className="flex flex-col gap-3 rounded-md border border-warn/40 bg-warn/10 p-3">
      <div role="alert" className="flex gap-3">
        <MailWarning className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <p className="font-head text-sm font-semibold text-text">
            Confirme seu email para entrar.
          </p>
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
  const { toast } = useToast();
  const login = useLogin();
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

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(null);
    setUnverified(false);
    try {
      const res = await login.mutateAsync(data);
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
        setUnverified(true);
        return;
      }
      // UX §2.11: erro com o quê / por quê / o que fazer. Mostrado inline (no
      // mobile o toast pode ficar atrás do teclado) e também via toast.
      const isBadCreds = err instanceof ApiError && err.status === 401;
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
      toast({
        variant: 'error',
        title: nextError.title,
        description: nextError.description,
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {notice && !sessionExpired && !submitError && !unverified && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-md border border-success/40 bg-success/10 p-3"
        >
          <UserCheck className="size-5 shrink-0 text-success" aria-hidden />
          <p className="font-head text-sm font-semibold text-text">{LOGIN_NOTICE_COPY[notice]}</p>
        </div>
      )}
      {unverified && <UnverifiedPanel email={typedEmail} />}
      {sessionExpired && !submitError && !unverified && (
        <div role="status" className="flex gap-3 rounded-md border border-info/40 bg-info/10 p-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="font-head text-sm font-semibold text-text">
              Sua sessão terminou. Entre de novo.
            </p>
            <p className="font-body text-sm text-text-mid">
              Por segurança, o acesso expira depois de um tempo. Você volta para onde estava.
            </p>
          </div>
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
      <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
        Entrar
      </Button>
      <Link
        href="/reset-password"
        className="touch-target flex items-center justify-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
      >
        Esqueci minha senha
      </Link>
      <p className="text-center font-body text-sm text-text-low">
        Não tem conta?{' '}
        <Link
          href="/signup"
          className="font-medium text-text outline-none hover:text-brand focus-visible:underline"
        >
          Criar conta
        </Link>
      </p>
    </form>
  );
}
