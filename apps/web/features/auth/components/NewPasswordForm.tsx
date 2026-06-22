'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { api } from '@/shared/lib/api-client';
import { newPasswordSchema, type NewPasswordInput } from '../schema';

/**
 * Define a nova senha a partir do token do link de recuperação.
 * POST /auth/reset/confirm { token, password } (seam de backend — ver COMMS F44).
 * Força de senha + confirmação validadas no cliente (espelham o server).
 */
export function NewPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? params.get('token_hash') ?? '';
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = useMutation({
    mutationFn: (password: string) =>
      api.post<{ ok: true }>('/auth/reset/confirm', { token, password }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordInput>({ resolver: zodResolver(newPasswordSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setFailed(false);
    try {
      await submit.mutateAsync(data.password);
      setDone(true);
    } catch {
      setFailed(true);
    }
  });

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <p className="font-body text-sm text-text-mid">
            Link de redefinição inválido. Solicite um novo na tela de recuperação.
          </p>
        </div>
        <Link
          href="/reset-password"
          className="touch-target flex items-center justify-center font-body text-sm text-text-low hover:text-text"
        >
          Solicitar novo link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <p className="font-body text-text-mid">
            Senha redefinida. Faça login com a nova senha.
          </p>
        </div>
        <Link
          href="/login"
          className="touch-target flex items-center justify-center font-body text-sm text-text-low hover:text-text"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {failed && (
        <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="font-head text-sm font-semibold text-text">Não foi possível redefinir</p>
            <p className="font-body text-sm text-text-mid">
              O link pode ter expirado. Solicite um novo na tela de recuperação.
            </p>
          </div>
        </div>
      )}
      <Input
        label="Nova senha"
        type="password"
        size="lg"
        autoComplete="new-password"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="ao menos 10 caracteres"
        error={errors.password?.message}
        {...register('password')}
      />
      <Input
        label="Confirme a nova senha"
        type="password"
        size="lg"
        autoComplete="new-password"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="repita a senha"
        error={errors.confirm?.message}
        {...register('confirm')}
      />
      <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
        Redefinir senha
      </Button>
    </form>
  );
}
