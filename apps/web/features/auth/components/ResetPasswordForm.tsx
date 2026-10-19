'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, MailCheck } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { useAuthCompanion, useAuthCompanionStep } from '@/features/auth/companion';
import { resetSchema, type ResetInput } from '../schema';
import { useRequestReset } from '../queries';
import {
  AuthHeading,
  AuthNotice,
  AuthStepTransition,
  quietLinkClass,
  secondaryLinkClass,
} from './AuthKit';

export function ResetPasswordForm() {
  const requestReset = useRequestReset();
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  // Companheiro: só SINAIS (etapa, envio, resultado). Nenhum valor de campo passa por aqui.
  useAuthCompanionStep(sent ? 'reset-sent' : 'reset-request');
  const companion = useAuthCompanion();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetInput>({ resolver: zodResolver(resetSchema) });

  const onValid = async (data: ResetInput) => {
    setFailed(false);
    companion.signal({ type: 'submit' });
    try {
      await requestReset.mutateAsync(data);
      companion.signal({ type: 'success', final: true });
      setSent(true);
    } catch {
      companion.signal({ type: 'error', kind: 'server' });
      // UX §2.11: erro em 3 partes, inline (mobile-safe — teclado não esconde).
      setFailed(true);
    }
  };
  const onSubmit = handleSubmit(onValid, () =>
    companion.signal({ type: 'error', kind: 'validation' }),
  );

  if (sent) {
    return (
      <AuthStepTransition stepKey="reset-sent">
        <AuthHeading
          eyebrow="Recuperação de acesso"
          title="Confira sua caixa de entrada"
          lead="O link de redefinição vale por pouco tempo."
          focusOnMount
        />
        <div className="flex flex-col gap-5">
          <AuthNotice role="status" tone="neutral" icon={<MailCheck aria-hidden />}>
            Se houver uma conta com esse email, enviamos as instruções de redefinição. Verifique sua
            caixa de entrada.
          </AuthNotice>
          <Link href="/login" className={secondaryLinkClass}>
            Voltar ao login
          </Link>
        </div>
      </AuthStepTransition>
    );
  }

  return (
    <AuthStepTransition stepKey="reset-request">
      <AuthHeading
        eyebrow="Recuperação de acesso"
        title="Redefinir senha"
        lead="Informe seu email e enviaremos as instruções."
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {failed && (
          <AuthNotice
            role="alert"
            tone="danger"
            icon={<AlertTriangle aria-hidden />}
            title="Não foi possível enviar"
          >
            Algo deu errado na solicitação. Tente novamente em instantes.
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
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Enviar instruções
        </Button>
        <div className="flex justify-center border-t border-border pt-3">
          <Link href="/login" className={quietLinkClass}>
            Voltar ao login
          </Link>
        </div>
      </form>
    </AuthStepTransition>
  );
}
