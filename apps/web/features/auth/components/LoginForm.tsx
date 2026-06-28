'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import { Button, Input, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { safeNextPath } from '@/shared/lib/safe-redirect';
import { loginSchema, type LoginInput } from '../schema';
import { useLogin } from '../queries';

/** Erro de submit em 3 partes (UX §2.11): o quê / por quê / o que fazer. */
interface SubmitError {
  title: string;
  description: string;
}

export function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const login = useLogin();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(null);
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
      // e só permite caminho interno same-origin.
      const rawNext =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('next')
          : null;
      router.push(safeNextPath(rawNext));
      router.refresh();
    } catch (err) {
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
