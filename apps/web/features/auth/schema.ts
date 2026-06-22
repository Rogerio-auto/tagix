import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'A senha tem no mínimo 8 caracteres'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const resetSchema = z.object({
  email: z.string().email('Email inválido'),
});
export type ResetInput = z.infer<typeof resetSchema>;

/** Força de senha espelhando o server (F44-S04): >=10, com letra e número. */
export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome'),
  email: z.string().email('Email inválido'),
  password: z
    .string()
    .min(10, 'A senha precisa de ao menos 10 caracteres')
    .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
      message: 'Use letras e números na senha',
    }),
  workspaceName: z.string().trim().min(1, 'Informe o nome do workspace'),
});
export type SignupInput = z.infer<typeof signupSchema>;

/** Nova senha (fluxo de verify/reset com token) — F44-S06. */
export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, 'A senha precisa de ao menos 10 caracteres')
      .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
        message: 'Use letras e números na senha',
      }),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'As senhas não conferem',
    path: ['confirm'],
  });
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
