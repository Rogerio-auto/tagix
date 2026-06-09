'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input } from '@hm/ui';
import { resetSchema, type ResetInput } from '../schema';
import { useRequestReset } from '../queries';

export function ResetPasswordForm() {
  const requestReset = useRequestReset();
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetInput>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async (data) => {
    await requestReset.mutateAsync(data);
    setSent(true);
  });

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-text-mid">
          Se houver uma conta com esse email, enviamos as instruções de redefinição. Verifique
          sua caixa de entrada.
        </p>
        <Link
          href="/login"
          className="text-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
        >
          Voltar ao login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="voce@empresa.com"
        error={errors.email?.message}
        {...register('email')}
      />
      <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
        Enviar instruções
      </Button>
      <Link
        href="/login"
        className="text-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
      >
        Voltar ao login
      </Link>
    </form>
  );
}
