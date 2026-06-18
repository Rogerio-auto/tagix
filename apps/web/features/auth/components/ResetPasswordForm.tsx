'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, MailCheck } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { resetSchema, type ResetInput } from '../schema';
import { useRequestReset } from '../queries';

export function ResetPasswordForm() {
  const requestReset = useRequestReset();
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetInput>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setFailed(false);
    try {
      await requestReset.mutateAsync(data);
      setSent(true);
    } catch {
      // UX §2.11: erro em 3 partes, inline (mobile-safe — teclado não esconde).
      setFailed(true);
    }
  });

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <p className="font-body text-text-mid">
            Se houver uma conta com esse email, enviamos as instruções de redefinição.
            Verifique sua caixa de entrada.
          </p>
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
      {failed && (
        <div
          role="alert"
          className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="font-head text-sm font-semibold text-text">
              Não foi possível enviar
            </p>
            <p className="font-body text-sm text-text-mid">
              Algo deu errado na solicitação. Tente novamente em instantes.
            </p>
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
      <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
        Enviar instruções
      </Button>
      <Link
        href="/login"
        className="touch-target flex items-center justify-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
      >
        Voltar ao login
      </Link>
    </form>
  );
}
