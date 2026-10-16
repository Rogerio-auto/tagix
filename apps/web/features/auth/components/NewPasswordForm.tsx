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
import { AuthHeading, AuthNotice, primaryLinkClass } from './AuthKit';

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
      <>
        <AuthHeading
          eyebrow="Recuperação de acesso"
          title="Link de redefinição inválido"
          lead="Solicite um novo na tela de recuperação."
        />
        <Link href="/reset-password" className={primaryLinkClass}>
          Solicitar novo link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthHeading
          eyebrow="Recuperação de acesso"
          title="Senha redefinida"
          lead="Faça login com a nova senha."
          focusOnMount
        />
        <div role="status" className="flex flex-col gap-5">
          <AuthNotice tone="success" icon={<CheckCircle2 aria-hidden />} title="Tudo certo">
            A senha antiga deixou de valer.
          </AuthNotice>
          <Link href="/login" className={primaryLinkClass}>
            Ir para o login
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        eyebrow="Recuperação de acesso"
        title="Definir nova senha"
        lead="Escolha uma nova senha para a sua conta."
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {failed && (
          <AuthNotice
            role="alert"
            tone="danger"
            icon={<AlertTriangle aria-hidden />}
            title="Não foi possível redefinir"
          >
            O link pode ter expirado. Solicite um novo na tela de recuperação.
          </AuthNotice>
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
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Redefinir senha
        </Button>
      </form>
    </>
  );
}
