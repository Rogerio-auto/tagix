/**
 * Cadastro self-serve (F44-S04). Orquestra: captcha → rate-limit (no router) →
 * validação Zod strict → denylist de email descartável → criação do usuário no
 * provider (email NÃO confirmado) → provisionamento do workspace (sem platform
 * admin) com rollback se o tenant falhar. SEM auto-login. Resposta uniforme.
 *
 * Anti-enumeração (T3): a resposta e o caminho de tempo são uniformes — email já
 * existente, descartável ou novo retornam o MESMO 202. O trabalho condicional fica
 * atrás de uma resposta constante, sem sinal observável.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { provisionWorkspaceWithOwner } from '@hm/db';
import { AuthError } from '@hm/shared';
import { getAuthProvider } from './provider';
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
    await auditAuthEvent('auth.signup', req, { email: input.email, outcome: 'rejected_disposable' });
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

  // Provisiona o tenant — IDEMPOTENTE (o provisioner ancora por email). Roda tanto para
  // cadastro novo (created:true) quanto para usuário já existente (created:false). Isso
  // FECHA a armadilha do órfão (#3): se um signup anterior criou o usuário no provider
  // mas o tenant falhou (transação revertida → sem member/workspace), o retry agora
  // provisiona o workspace que faltava. Para um usuário que JÁ tem workspace, o
  // provisioner é no-op (created:false) — sem duplicar (T13) e sem reenviar email.
  try {
    const result = await provisionWorkspaceWithOwner({
      ownerEmail: input.email,
      ownerName: input.name,
      authUserId: signUp.authUserId,
      workspaceName: input.workspaceName,
      pendingPlanKey: input.plan,
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

/** Handler HTTP: valida, executa em tempo ~uniforme e responde 202 constante. */
export async function signupHandler(req: Request, res: Response): Promise<void> {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    // Validação estrutural pode divergir cedo — é aceitável (não revela existência
    // de conta, só forma do payload). Mensagem genérica de campos.
    res.status(400).json({ message: 'Dados inválidos. Confira os campos e tente de novo.' });
    return;
  }
  await performSignup(parsed.data, req);
  res.status(202).json(UNIFORM_RESPONSE);
}
