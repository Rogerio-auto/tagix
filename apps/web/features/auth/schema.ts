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
