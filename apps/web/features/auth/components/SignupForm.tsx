'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, MailCheck } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { signupSchema, type SignupInput } from '../schema';
import { useSignup } from '../queries';
import { TurnstileWidget } from './TurnstileWidget';

/** UX §2.11: erro em 3 partes. */
interface SubmitError {
  title: string;
  description: string;
}

export function SignupForm() {
  const signup = useSignup();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState('');
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });

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
      await signup.mutateAsync({ ...data, turnstileToken: token });
      // Resposta uniforme — sucesso = "verifique seu email" (sem auto-login).
      setSent(true);
    } catch {
      setSubmitError({
        title: 'Não foi possível criar a conta',
        description: 'Algo deu errado. Recarregue a página e tente novamente.',
      });
    }
  });

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-head text-sm font-semibold text-text">Confirme seu email</p>
            <p className="font-body text-sm text-text-mid">
              Se os dados estiverem corretos, enviamos um link de confirmação. Abra-o para
              ativar sua conta — você só acessa o Leadium depois de confirmar.
            </p>
          </div>
        </div>
        <Link
          href="/login"
          className="touch-target flex items-center justify-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
        >
          Voltar ao login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {submitError && (
        <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
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
        hint={password.length > 0 ? passwordHint(password) : 'Use letras e números, mín. 10 caracteres.'}
        error={errors.password?.message}
        {...register('password')}
      />
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
  if (password.length < 10 || !hasLetter || !hasNumber) return 'Senha fraca — combine letras e números.';
  if (password.length >= 14 && hasSymbol) return 'Senha forte.';
  return 'Senha boa.';
}
