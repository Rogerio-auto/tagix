import { signupSchema } from '@/features/auth/schema';

/**
 * Regras e dica de força da senha, iguais às do cadastro (`signupSchema.password`,
 * espelho do servidor: >=10, com letra e número). O medidor visual do SignupForm é
 * uma função local não exportada (e a S09 está editando o arquivo); aqui o validador
 * é o MESMO schema importado e os limiares da dica seguem os de lá.
 */
export const invitePasswordSchema = signupSchema.shape.password;

export type StrengthLevel = 'empty' | 'weak' | 'good' | 'strong';

export interface Strength {
  level: StrengthLevel;
  /** Quantos dos 3 segmentos acendem. */
  segments: 0 | 1 | 2 | 3;
  label: string;
}

export function passwordStrength(password: string): Strength {
  if (password.length === 0) {
    return { level: 'empty', segments: 0, label: 'Use letras e números, mín. 10 caracteres.' };
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  if (password.length < 10 || !hasLetter || !hasNumber) {
    return { level: 'weak', segments: 1, label: 'Senha fraca — combine letras e números.' };
  }
  if (password.length >= 14 && hasSymbol) {
    return { level: 'strong', segments: 3, label: 'Senha forte.' };
  }
  return { level: 'good', segments: 2, label: 'Senha boa.' };
}
