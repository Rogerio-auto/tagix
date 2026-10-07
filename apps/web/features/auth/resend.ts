import { z } from 'zod';
import { ApiError } from '@/shared/lib/api-client';

/** Intervalo mínimo entre dois reenvios (a API ainda limita por IP+email). */
export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendFailure = 'captcha' | 'rate_limited' | 'invalid_email' | 'unknown';

/**
 * Traduz o erro de `POST /auth/resend-verification`. 200 é sempre uniforme (não
 * diz se a conta existe), então só chegam aqui falhas que NÃO vazam existência:
 * captcha recusado, limite de taxa, payload inválido.
 */
export function classifyResendError(err: unknown): ResendFailure {
  if (!(err instanceof ApiError)) return 'unknown';
  if (err.status === 429) return 'rate_limited';
  if (err.status === 400 && err.code === 'captcha_failed') return 'captcha';
  if (err.status === 400 && err.code === 'invalid_payload') return 'invalid_email';
  return 'unknown';
}

export interface ResendFailureCopy {
  title: string;
  description: string;
}

export const RESEND_FAILURE_COPY: Record<ResendFailure, ResendFailureCopy> = {
  captcha: {
    title: 'Verificação anti-robô recusada',
    description: 'Complete a verificação de novo e tente reenviar.',
  },
  rate_limited: {
    title: 'Muitos reenvios seguidos',
    description: 'Por segurança, espere alguns minutos antes de pedir outro email.',
  },
  invalid_email: {
    title: 'Confira o email digitado',
    description: 'O endereço não parece válido. Corrija e tente reenviar.',
  },
  unknown: {
    title: 'Não foi possível reenviar agora',
    description: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
  },
};

/** Mensagem de sucesso UNIFORME: idêntica exista ou não a conta (anti-enumeração). */
export function resendSuccessMessage(email: string): string {
  return `Se houver uma conta aguardando confirmação em ${email}, enviamos um novo link. Pode levar alguns minutos; olhe também o spam.`;
}

/** Segundos que faltam até `until` (ms epoch), arredondado para cima; nunca negativo. */
export function cooldownRemaining(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function resendButtonLabel(remainingSeconds: number): string {
  return remainingSeconds > 0 ? `Reenviar em ${remainingSeconds} s` : 'Reenviar email';
}

const emailSchema = z.string().trim().email().max(254);

export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

/** Aceita `?email=` só se for um email plausível (a URL pode ser escrita por qualquer um). */
export function sanitizeEmailParam(value: string | string[] | null | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '';
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : '';
}

export type LoginNotice = 'invite' | 'verified' | 'generic' | null;

/**
 * Aviso de boas-vindas do login conforme a origem:
 * - `from=invite`  → "Conta criada. Entre com sua senha."
 * - `from=verify`  → "Email confirmado. Entre com sua senha."
 * - só `?email=`   → "Entre com sua senha." (a S07 redireciona assim, sem `from`;
 *   não afirmamos "conta criada" sem saber a origem).
 */
export function loginNoticeFor(
  from: string | string[] | undefined,
  hasEmail: boolean,
): LoginNotice {
  const f = Array.isArray(from) ? from[0] : from;
  if (f === 'invite') return 'invite';
  if (f === 'verify') return 'verified';
  return hasEmail ? 'generic' : null;
}

export const LOGIN_NOTICE_COPY: Record<Exclude<LoginNotice, null>, string> = {
  invite: 'Conta criada. Entre com sua senha.',
  verified: 'Email confirmado. Entre com sua senha.',
  generic: 'Entre com sua senha.',
};
