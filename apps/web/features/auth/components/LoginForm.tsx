'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { loginSchema, type LoginInput } from '../schema';
import { useLogin } from '../queries';

export function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await login.mutateAsync(data);
      router.push('/');
      router.refresh();
    } catch (err) {
      // UX §2.11: erro com o quê / por quê / o que fazer.
      toast({
        variant: 'error',
        title: 'Não foi possível entrar',
        description:
          err instanceof ApiError && err.status === 401
            ? 'Email ou senha incorretos. Confira os dados e tente de novo.'
            : 'Algo deu errado ao autenticar. Tente novamente em instantes.',
      });
    }
  });

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
      <Input
        label="Senha"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        error={errors.password?.message}
        {...register('password')}
      />
      <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
        Entrar
      </Button>
      <Link
        href="/reset-password"
        className="text-center font-body text-sm text-text-low outline-none hover:text-text focus-visible:underline"
      >
        Esqueci minha senha
      </Link>
    </form>
  );
}
