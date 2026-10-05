/**
 * Reenvio do email de confirmação de cadastro (F71-S04, CONTAS_E_CONVITES A2/T3).
 *
 * Quem perdeu ou deixou expirar o link de confirmação pede outro aqui. A rota é
 * pública, então segue os controles de anti-enumeração da F44:
 *  - resposta CONSTANTE (`200 { ok: true }`) exista a conta ou não, confirmada ou não;
 *  - tempo CONSTANTE (`runWithUniformTiming`): a resposta sai sempre no piso
 *    configurado, independente do trabalho condicional (lookup + envio), que segue em
 *    segundo plano se passar do piso;
 *  - rate-limit por IP+email e por IP (montado no router, ver `resendLimiters`);
 *  - captcha server-side antes de qualquer consulta ao provider.
 *
 * Também exporta o piso de tempo usado pelo signup (mesmo mecanismo).
 */
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { createLogger } from '@hm/logger';
import { AuthError } from '@hm/shared';
import { getAuthProvider } from './provider';
import { auditAuthEvent, clientIp, rateLimit, verifyTurnstile } from '../middlewares/rate-limit';

const log = createLogger('info', { svc: '@hm/api', mod: 'auth.uniform' });

// ─── Tempo uniforme ──────────────────────────────────────────────────────────

/** Piso padrão das rotas públicas de auth com trabalho condicional (ms). */
export const DEFAULT_UNIFORM_RESPONSE_MS = 1200;
const MIN_UNIFORM_RESPONSE_MS = 50;
const MAX_UNIFORM_RESPONSE_MS = 10_000;

/**
 * Piso de tempo em ms (`AUTH_UNIFORM_RESPONSE_MS`, lido a cada request). Valor ausente
 * ou fora de [50, 10000] cai no padrão: um env mal escrito nunca desliga a proteção.
 */
export function uniformResponseMs(): number {
  const raw = process.env['AUTH_UNIFORM_RESPONSE_MS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_UNIFORM_RESPONSE_MS;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < MIN_UNIFORM_RESPONSE_MS ||
    value > MAX_UNIFORM_RESPONSE_MS
  ) {
    return DEFAULT_UNIFORM_RESPONSE_MS;
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa `work` e resolve EXATAMENTE quando o piso vence, nem antes nem depois:
 *  - trabalho mais rápido que o piso → espera o restante;
 *  - trabalho mais lento → a resposta sai no piso e o trabalho termina em segundo plano.
 *
 * Assim o tempo de resposta não carrega sinal do caminho tomado (conta existe, está
 * confirmada, o provider demorou). `work` não deve lançar; se lançar, o erro é logado
 * (sem PII) e engolido, porque a resposta já é constante.
 */
export async function runWithUniformTiming(
  label: string,
  work: () => Promise<void>,
  floorMs: number = uniformResponseMs(),
): Promise<void> {
  const floor = sleep(floorMs);
  void work().catch((err: unknown) => {
    log.error('uniform_work_failed', {
      label,
      error: err instanceof Error ? err.name : 'unknown',
    });
  });
  await floor;
}

// ─── Reenvio de confirmação ──────────────────────────────────────────────────

/** Zod STRICT: só email e captcha; nada mais vem do cliente. */
export const resendVerificationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    turnstileToken: z.string().min(1).max(4096),
  })
  .strict();

/** Corpo constante do reenvio (anti-enumeração). */
const UNIFORM_RESPONSE = { ok: true } as const;

/**
 * Limites de borda (T4): 3/h por IP+email (não vira canhão de email contra uma caixa)
 * e 20/h por IP (fecha o volume bruto de quem varia o email). Ordem no router: IP
 * primeiro, depois IP+email.
 */
export const resendLimiters: readonly RequestHandler[] = [
  rateLimit({ bucket: 'resend_ip', max: 20, windowSec: 60 * 60, byEmail: false }),
  rateLimit({ bucket: 'resend', max: 3, windowSec: 60 * 60 }),
];

/** Resultado do reenvio, só para auditoria (nunca vai ao cliente). */
type ResendOutcome = 'sent' | 'no_account' | 'already_confirmed' | 'invite_pending';

/**
 * Reenvia o email de confirmação SE a conta existe, não está confirmada e tem senha
 * própria. Conta criada por convite (sem senha) não recebe o email de cadastro: ela se
 * completa pelo link do convite, e confirmar o email dela aqui não leva a lugar nenhum.
 *
 * Usado pela rota de reenvio e pelo signup repetido. Falha do provider LANÇA
 * (`AuthError('provider_error')`): o caller decide (ambos auditam e seguem uniformes).
 */
export async function resendVerificationIfPending(email: string): Promise<ResendOutcome> {
  const provider = getAuthProvider();
  const account = await provider.findUserByEmail(email);
  if (!account) return 'no_account';
  if (account.emailConfirmed) return 'already_confirmed';
  if (!account.hasPassword) return 'invite_pending';
  await provider.resendVerification(email);
  return 'sent';
}

/**
 * `POST /auth/resend-verification { email, turnstileToken }`.
 *
 * - Payload inválido → `400 { error: 'invalid_payload' }` (só forma; não toca o provider).
 * - Captcha inválido → `400 { error: 'captcha_failed' }`. Não enumera: o veredito sai
 *   antes de qualquer consulta e não depende da conta. Responder 200 aqui faria o
 *   usuário legítimo achar que o email saiu quando nada foi enviado.
 * - Senão → SEMPRE `200 { ok: true }` no piso de tempo, qualquer que seja a conta.
 */
export async function resendVerificationHandler(req: Request, res: Response): Promise<void> {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_payload', message: 'Informe um email válido.' });
    return;
  }
  const { email, turnstileToken } = parsed.data;
  if (!(await verifyTurnstile(turnstileToken, clientIp(req)))) {
    res.status(400).json({
      error: 'captcha_failed',
      message: 'Verificação anti-robô falhou. Recarregue e tente de novo.',
    });
    return;
  }

  await runWithUniformTiming('auth.resend_verification', async () => {
    try {
      const outcome = await resendVerificationIfPending(email);
      await auditAuthEvent('auth.verification_resent', req, { email, outcome, via: 'resend' });
    } catch (err) {
      await auditAuthEvent('auth.verification_resent', req, {
        email,
        outcome: 'provider_error',
        via: 'resend',
        code: err instanceof AuthError ? err.code : 'unknown',
      });
    }
  });
  res.status(200).json(UNIFORM_RESPONSE);
}
