/**
 * Cadastro self-serve (F44-S04). Orquestra: captcha → rate-limit (no router) →
 * validação Zod strict → denylist de email descartável → criação do usuário no
 * provider (email NÃO confirmado) → provisionamento do workspace (sem platform
 * admin) com rollback se o tenant falhar. SEM auto-login. Resposta uniforme.
 *
 * Anti-enumeração (T3): a resposta e o tempo são uniformes — email já existente,
 * descartável ou novo retornam o MESMO 202, no MESMO piso de tempo
 * (`runWithUniformTiming`); o trabalho condicional (criar, provisionar, reenviar a
 * confirmação) não deixa sinal observável.
 *
 * F71-S04: aceite de termos obrigatório (gravado no OWNER, LGPD — A7) e signup repetido
 * de conta ainda não confirmada reenvia a confirmação (A2).
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { provisionWorkspaceWithOwner } from '@hm/db';
import { AuthError } from '@hm/shared';
import { getAuthProvider } from './provider';
import { resendVerificationIfPending, runWithUniformTiming } from './resend';
import { auditAuthEvent } from '../middlewares/rate-limit';
import { DISPOSABLE_EMAIL_DOMAINS } from './disposable-domains';

/** Força de senha mínima: ≥10, com letra e número (defesa server-side, T6). */
export const strongPassword = z
  .string()
  .min(10, 'A senha precisa de ao menos 10 caracteres.')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Use letras e números na senha.',
  });

/**
 * Versão do texto aceito = data de "Atualizados em" de `/termos` e `/privacidade`, em
 * `AAAA-MM-DD` (hoje `2026-09-14`). Data de calendário válida; nada além disso.
 */
export const termsVersionSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Versão dos termos inválida.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Versão dos termos inválida.');

/** Zod STRICT: rejeita campos extras (T9 — sem workspaceId/role/isPlatformAdmin do body). */
export const signupSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe seu nome.').max(120),
    email: z.string().trim().toLowerCase().email('Email inválido.').max(254),
    password: strongPassword,
    workspaceName: z.string().trim().min(1, 'Informe o nome do workspace.').max(120),
    turnstileToken: z.string().min(1).max(4096),
    // Plano escolhido na página de venda (opcional). Apenas INTENÇÃO de upgrade —
    // o provisioner valida contra o catálogo e só grava se for plano pago existente.
    // Nunca libera plano pago aqui; o checkout acontece pós-login (com pagamento).
    plan: z.string().trim().toLowerCase().max(40).optional(),
    // Aceite dos Termos de uso e da Política de privacidade (LGPD). Só `true` passa:
    // ausente ou `false` → 400, nada é criado.
    acceptTerms: z.literal(true),
    termsVersion: termsVersionSchema,
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;

/** Resposta uniforme do signup — idêntica em todos os cenários (anti-enumeração). */
const UNIFORM_RESPONSE = { status: 'verification_sent' } as const;

function isDisposable(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain !== undefined && DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/**
 * Núcleo do signup, já validado. Idempotente e com compensação (T14): se o provider
 * cria o usuário mas o provisionamento do tenant falha, tenta compensar e ainda
 * responde uniforme (não deixa estado parcial observável).
 */
export async function performSignup(input: SignupInput, req: Request): Promise<void> {
  // Email descartável: trata como sucesso uniforme (não revela a política — T3),
  // mas NÃO provisiona nada.
  if (isDisposable(input.email)) {
    await auditAuthEvent('auth.signup', req, {
      email: input.email,
      outcome: 'rejected_disposable',
    });
    return;
  }

  const provider = getAuthProvider();
  let signUp;
  try {
    signUp = await provider.signUp({ email: input.email, password: input.password });
  } catch (err) {
    // Falha do provider: audita e segue para a resposta uniforme (sem vazar o motivo).
    await auditAuthEvent('auth.signup', req, {
      email: input.email,
      outcome: 'provider_error',
      code: err instanceof AuthError ? err.code : 'unknown',
    });
    return;
  }

  // Sem authUserId (lookup do provider falhou): resposta uniforme, nada a provisionar.
  if (!signUp.authUserId) {
    await auditAuthEvent('auth.signup', req, { email: input.email, outcome: 'no_provider_user' });
    return;
  }

  // O aceite vale a partir de agora (servidor), nunca de um horário vindo do cliente.
  const termsAcceptedAt = new Date();

  // Decisão de produto (CONTAS_E_CONVITES §1 item 3): quem foi convidado a outra empresa e faz
  // signup ganha a PRÓPRIA empresa — por isso provisionamos também para conta já confirmada.
  // A empresa nasce `invited` e só ativa quando o dono confirma pelo verify, então o vetor de
  // poluição (terceiro digitando o email alheio) é baixo; endurecimento fica para o F71-S19
  // (criar empresa autenticado + signup público de conta confirmada deixa de provisionar).
  const shouldProvision = true;

  // Provisiona o tenant — IDEMPOTENTE (o provisioner ancora por email). Roda para cadastro
  // novo (created:true) e para conta existente (created:false). Isso
  // FECHA a armadilha do órfão (#3): se um signup anterior criou o usuário no provider
  // mas o tenant falhou (transação revertida → sem member/workspace), o retry agora
  // provisiona o workspace que faltava. Para um usuário que JÁ tem workspace, o
  // provisioner é no-op (created:false) — sem duplicar (T13) e sem reenviar email.
  if (shouldProvision) {
    try {
      const result = await provisionWorkspaceWithOwner({
        ownerEmail: input.email,
        ownerName: input.name,
        authUserId: signUp.authUserId,
        workspaceName: input.workspaceName,
        pendingPlanKey: input.plan,
        termsAcceptedAt,
        termsVersion: input.termsVersion,
      });
      await auditAuthEvent('auth.signup', req, {
        email: input.email,
        outcome: result.created ? 'provisioned' : 'already_provisioned',
        workspaceId: result.workspaceId,
        slug: result.slug,
      });
    } catch (err) {
      // Compensação (T14): tenant falhou após criar o usuário no provider. Marca o
      // evento para reconciliação; o usuário órfão fica sem workspace e nunca acessa
      // (resolveSession exige member active) — e o PRÓXIMO retry o reprovisiona (acima).
      // Não relança — resposta uniforme.
      await auditAuthEvent('auth.signup', req, {
        email: input.email,
        outcome: 'provision_failed_orphan_user',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Signup repetido (A2): a conta já existia. Se ainda não confirmou o email, quem está
  // tentando de novo provavelmente perdeu o link — reenvia. Conta confirmada ou criada
  // por convite: nada. Fica dentro do piso de tempo, então a resposta não muda.
  if (!signUp.created) {
    try {
      const outcome = await resendVerificationIfPending(input.email);
      if (outcome === 'sent') {
        await auditAuthEvent('auth.verification_resent', req, {
          email: input.email,
          outcome,
          via: 'signup',
        });
      }
    } catch (err) {
      await auditAuthEvent('auth.verification_resent', req, {
        email: input.email,
        outcome: 'provider_error',
        via: 'signup',
        code: err instanceof AuthError ? err.code : 'unknown',
      });
    }
  }
}

/** Handler HTTP: valida, executa no piso de tempo uniforme e responde 202 constante. */
export async function signupHandler(req: Request, res: Response): Promise<void> {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    // Validação estrutural pode divergir cedo — é aceitável (não revela existência
    // de conta, só forma do payload). Mensagem genérica de campos.
    res.status(400).json({ message: 'Dados inválidos. Confira os campos e tente de novo.' });
    return;
  }
  const input = parsed.data;
  await runWithUniformTiming('auth.signup', () => performSignup(input, req));
  res.status(202).json(UNIFORM_RESPONSE);
}
