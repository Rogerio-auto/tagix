/**
 * Provisionamento de tenant para o cadastro self-serve (F44-S02).
 *
 * `provisionWorkspaceWithOwner(...)` cria o ESQUELETO de um workspace novo de forma
 * IDEMPOTENTE: workspace + member OWNER (NUNCA platform admin) + subscription trial
 * no plano `free`. Mesma forma do `seed-owner.ts`, porém:
 *   - chamável de uma rota (não é script de bootstrap),
 *   - `isPlatformAdmin:false` SEMPRE (invariante de segurança — T9),
 *   - member nasce `status:'invited'` (pré-verify): bloqueio duro de acesso, pois
 *     `resolveSession` rejeita member com `status !== 'active'` (T7). O `/auth/verify`
 *     (F44-S04) promove para `active`.
 *
 * FRONTEIRA DE PRIVILÉGIO (T8): criar workspace+member acontece ANTES de existir um
 * `workspace_id` no escopo — logo roda no caminho privilegiado (`getDb()`, role dono,
 * fora de RLS). É o mínimo indispensável e está isolado aqui. QUALQUER recurso
 * scoped subsequente (não há nenhum neste esqueleto; o blueprint de nicho é aplicado
 * depois, via `instantiateNicheBlueprint` sob `withWorkspace`) corre sob RLS.
 *
 * IDEMPOTÊNCIA (T13): re-rodar com o mesmo email/slug não duplica — retorna o existente
 * com `created:false`. O lookup é por (a) member por email global, (b) workspace por slug.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { members, plans, subscriptions, workspaces } from '../schema';
import { slugCandidate, slugifyWorkspaceName } from './slug';

export interface ProvisionWorkspaceInput {
  /** Email do owner (normalizado p/ lowercase pelo helper). */
  ownerEmail: string;
  /** Nome do owner (exibição). */
  ownerName: string;
  /** Id do usuário no provider de auth (Supabase). Já criado pelo caller (F44-S04). */
  authUserId: string;
  /** Nome do workspace (origem do slug). */
  workspaceName: string;
  /** Slug explícito (opcional). Ausente → derivado do nome com dedupe. */
  workspaceSlug?: string;
  /**
   * KEY do plano escolhido na página de venda (intenção de upgrade). O tenant
   * SEMPRE nasce free/trial; este campo só é gravado em `subscriptions.pending_plan_key`
   * quando aponta para um plano PAGO existente no catálogo — o app redireciona ao
   * checkout pós-login e limpa o campo. Nunca libera plano pago sem pagamento.
   */
  pendingPlanKey?: string;
}

export interface ProvisionWorkspaceResult {
  workspaceId: string;
  memberId: string;
  slug: string;
  /** false quando o tenant já existia (idempotência). */
  created: boolean;
}

const MAX_SLUG_ATTEMPTS = 50;

export async function provisionWorkspaceWithOwner(
  input: ProvisionWorkspaceInput,
): Promise<ProvisionWorkspaceResult> {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerName = input.ownerName.trim() || 'Owner';
  const wsName = input.workspaceName.trim() || 'Meu workspace';

  const db = getDb();

  // Plano free (catálogo global). Garante presença sem duplicar.
  const [freePlan] = await db.select().from(plans).where(eq(plans.key, 'free'));
  if (!freePlan) {
    throw new Error('Plano free ausente no catálogo. Rode os seeds de planos antes do signup.');
  }

  // Intenção de plano (página de venda): só vira pending quando aponta para um plano
  // PAGO e ativo no catálogo. 'free'/inexistente/inativo → null (sem checkout). A
  // decisão é data-driven (não hardcode de keys) — admin pode criar novos planos.
  const pendingPlanKey = await resolvePendingPlanKey(db, input.pendingPlanKey);

  // ─── Idempotência: member já existe por email? → tenant já provisionado.
  const [existingMember] = await db.select().from(members).where(eq(members.email, ownerEmail));
  if (existingMember) {
    const [ws] = await db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, existingMember.workspaceId));
    return {
      workspaceId: existingMember.workspaceId,
      memberId: existingMember.id,
      slug: ws?.slug ?? '',
      created: false,
    };
  }

  // ─── Slug livre (explícito ou derivado com dedupe — slug é UNIQUE).
  const base = input.workspaceSlug
    ? slugifyWorkspaceName(input.workspaceSlug)
    : slugifyWorkspaceName(wsName);
  let slug = base;
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = slugCandidate(base, attempt);
    const [taken] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!taken) {
      slug = candidate;
      break;
    }
    if (attempt === MAX_SLUG_ATTEMPTS - 1) {
      throw new Error('Não foi possível derivar um slug livre para o workspace.');
    }
  }

  // ─── Passo privilegiado isolado (fora de RLS): workspace + member + subscription.
  // Tudo numa transação para não deixar tenant órfão (atomicidade local).
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: wsName,
        slug,
        planId: freePlan.id,
        subscriptionStatus: 'trial',
      })
      .returning({ id: workspaces.id, slug: workspaces.slug });
    if (!workspace) throw new Error('Falha ao criar workspace.');

    // INVARIANTE DE SEGURANÇA (T9): isPlatformAdmin SEMPRE false no signup self-serve.
    // status:'invited' = pré-verify (bloqueio duro; resolveSession exige 'active').
    const [member] = await tx
      .insert(members)
      .values({
        workspaceId: workspace.id,
        authUserId: input.authUserId,
        email: ownerEmail,
        name: ownerName,
        role: 'OWNER',
        status: 'invited',
        isPlatformAdmin: false,
      })
      .onConflictDoNothing()
      .returning({ id: members.id });

    const memberId = member?.id;
    if (!memberId) {
      // Corrida rara: outro request criou o member entre o lookup e o insert.
      const [raced] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.workspaceId, workspace.id), eq(members.email, ownerEmail)));
      if (!raced) throw new Error('Falha ao criar member OWNER.');
      return { workspaceId: workspace.id, memberId: raced.id, slug: workspace.slug, created: true };
    }

    await tx.insert(subscriptions).values({
      workspaceId: workspace.id,
      planId: freePlan.id,
      status: 'trial',
      billingCycle: 'monthly',
      pendingPlanKey,
    });

    return { workspaceId: workspace.id, memberId, slug: workspace.slug, created: true };
  });
}

/**
 * Resolve a intenção de plano da venda para uma KEY de plano PAGO existente, ou null.
 * Validação data-driven contra o catálogo (não hardcode): a key precisa existir, estar
 * ativa e ter preço mensal > 0. Qualquer outra coisa (free, inexistente, inativo,
 * undefined) → null (sem intenção de checkout).
 */
async function resolvePendingPlanKey(
  db: ReturnType<typeof getDb>,
  rawKey: string | undefined,
): Promise<string | null> {
  const key = rawKey?.trim().toLowerCase();
  if (!key || key === 'free') return null;
  const [plan] = await db
    .select({ key: plans.key, price: plans.priceMonthlyCents, active: plans.isActive })
    .from(plans)
    .where(eq(plans.key, key))
    .limit(1);
  if (!plan || !plan.active || plan.price <= 0) return null;
  return plan.key;
}
