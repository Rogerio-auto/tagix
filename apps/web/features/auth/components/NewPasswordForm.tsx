'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { api } from '@/shared/lib/api-client';
import { useAuthCompanion, useAuthCompanionStep } from '@/features/auth/companion';
import { newPasswordSchema, type NewPasswordInput } from '../schema';
import { AuthHeading, AuthNotice, AuthStepTransition, primaryLinkClass } from './AuthKit';

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
  // Companheiro: só SINAIS (etapa, envio, resultado). Nenhum valor de campo passa por aqui.
  useAuthCompanionStep(done ? 'reset-done' : 'reset-new');
  const companion = useAuthCompanion();
  // Link sem token: o companheiro reage como a um link inválido ("hm?"), uma vez só.
  const reportedMissing = useRef(false);
  useEffect(() => {
    if (token || reportedMissing.current) return;
    reportedMissing.current = true;
    companion.signal({ type: 'error', kind: 'server' });
  }, [token, companion]);

  const submit = useMutation({
    mutationFn: (password: string) =>
      api.post<{ ok: true }>('/auth/reset/confirm', { token, password }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordInput>({ resolver: zodResolver(newPasswordSchema) });

  const onValid = async (data: NewPasswordInput) => {
    setFailed(false);
    companion.signal({ type: 'submit' });
    try {
      await submit.mutateAsync(data.password);
      companion.signal({ type: 'success', final: true });
      setDone(true);
    } catch {
      companion.signal({ type: 'error', kind: 'server' });
      setFailed(true);
    }
  };
  const onSubmit = handleSubmit(onValid, () =>
    companion.signal({ type: 'error', kind: 'validation' }),
  );

  if (!token) {
    return (
      <AuthStepTransition stepKey="reset-invalid">
        <AuthHeading
          eyebrow="Recuperação de acesso"
          title="Link de redefinição inválido"
          lead="Solicite um novo na tela de recuperação."
        />
        <Link href="/reset-password" className={primaryLinkClass}>
          Solicitar novo link
        </Link>
      </AuthStepTransition>
    );
  }

  if (done) {
    return (
      <AuthStepTransition stepKey="reset-done">
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
      </AuthStepTransition>
    );
  }

  return (
    <AuthStepTransition stepKey="reset-new">
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
    </AuthStepTransition>
  );
}
