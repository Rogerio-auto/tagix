'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Input, cn } from '@hm/ui';
import { invitePasswordSchema, passwordStrength, type StrengthLevel } from '../password-strength';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome'),
  password: invitePasswordSchema,
});
export type CreatePasswordValues = z.infer<typeof formSchema>;

const BAR_TONE: Record<StrengthLevel, string> = {
  empty: 'bg-surface-3',
  weak: 'bg-danger',
  good: 'bg-warn',
  strong: 'bg-success',
};

/** Três segmentos finos + a frase. A frase é o que o leitor de tela anuncia. */
export function PasswordMeter({ password }: { password: string }): React.JSX.Element {
  const s = passwordStrength(password);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-pill transition-colors duration-200 motion-reduce:transition-none',
              i <= s.segments ? BAR_TONE[s.level] : 'bg-surface-3',
            )}
          />
        ))}
      </div>
      <p
        className={cn('font-body text-xs', s.level === 'weak' ? 'text-danger' : 'text-text-low')}
        aria-live="polite"
      >
        {s.label}
      </p>
    </div>
  );
}

export interface CreatePasswordFormProps {
  busy: boolean;
  onSubmit: (values: CreatePasswordValues) => void | Promise<void>;
}

/** Nome + senha — o convidado sem conta cria a dele aqui (a prova do email já está em memória). */
export function CreatePasswordForm({ busy, onSubmit }: CreatePasswordFormProps): React.JSX.Element {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreatePasswordValues>({ resolver: zodResolver(formSchema) });
  const password = watch('password') ?? '';

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <Input
        label="Seu nome"
        size="lg"
        autoComplete="name"
        placeholder="Maria Silva"
        error={errors.name?.message}
        {...register('name')}
      />
      <div className="flex flex-col gap-2">
        <Input
          label="Crie uma senha"
          type="password"
          size="lg"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ao menos 10 caracteres"
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordMeter password={password} />
      </div>
      <Button type="submit" size="lg" loading={busy} className="w-full">
        Criar conta e entrar
      </Button>
    </form>
  );
}
