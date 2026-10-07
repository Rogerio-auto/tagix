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
 * IDEMPOTÊNCIA (T13, refeita na F71-S01): "esta PESSOA (`authUserId`) já é OWNER de alguma
 * empresa" → devolve essa empresa com `created:false`. Antes era "o email existe em qualquer
 * empresa", o que fazia quem foi CONVIDADO para outra empresa nunca conseguir criar a própria
 * (o signup devolvia a empresa de quem convidou). Agora o convidado ganha a empresa dele. A
 * checagem roda dentro da transação, depois de um advisory lock por `authUserId`: dois signups
 * simultâneos da mesma pessoa não criam duas empresas.
 *
 * TRIAL (F71-S01): `trial_ends_at = now() + 15 dias` em `workspaces` e `subscriptions`, com o
 * relógio do banco (o mesmo instante nas duas, o mesmo que a expiração da S06 compara).
 *
 * TERMOS (F71-S01, consumido pela S04): `termsAcceptedAt` + `termsVersion` opcionais, gravados
 * no OWNER. Os dois juntos ou nenhum (`members_terms_chk`).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
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
  /** Quando o dono aceitou termos e privacidade no cadastro (LGPD). Exige `termsVersion`. */
  termsAcceptedAt?: Date;
  /** Versão do texto aceito (1..64 caracteres). Exige `termsAcceptedAt`. */
  termsVersion?: string;
}

export interface ProvisionWorkspaceResult {
  workspaceId: string;
  memberId: string;
  slug: string;
  /** false quando o tenant já existia (idempotência). */
  created: boolean;
}

const MAX_SLUG_ATTEMPTS = 50;

/** Duração do trial de toda empresa nova (CONTAS_E_CONVITES §3.3). */
export const TRIAL_DAYS = 15;
const trialEndsAtSql = sql`now() + make_interval(days => ${TRIAL_DAYS})`;

export async function provisionWorkspaceWithOwner(
  input: ProvisionWorkspaceInput,
): Promise<ProvisionWorkspaceResult> {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerName = input.ownerName.trim() || 'Owner';
  const wsName = input.workspaceName.trim() || 'Meu workspace';
  const terms = resolveTerms(input);

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
    // ─── Idempotência: esta pessoa já é OWNER de alguma empresa? Serializa por pessoa.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`hm:provision:${input.authUserId}`}, 0))`,
    );
    const [owned] = await tx
      .select({ workspaceId: members.workspaceId, memberId: members.id, slug: workspaces.slug })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(and(eq(members.authUserId, input.authUserId), eq(members.role, 'OWNER')))
      .orderBy(asc(members.createdAt))
      .limit(1);
    if (owned) {
      return {
        workspaceId: owned.workspaceId,
        memberId: owned.memberId,
        slug: owned.slug,
        created: false,
      };
    }

    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: wsName,
        slug,
        planId: freePlan.id,
        subscriptionStatus: 'trial',
        trialEndsAt: trialEndsAtSql,
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
        termsAcceptedAt: terms?.acceptedAt ?? null,
        termsVersion: terms?.version ?? null,
      })
      .returning({ id: members.id });
    // Empresa recém-criada nesta transação: não há linha com que conflitar. A corrida entre
    // signups da mesma pessoa é fechada pelo advisory lock acima.
    const memberId = member?.id;
    if (!memberId) throw new Error('Falha ao criar member OWNER.');

    await tx.insert(subscriptions).values({
      workspaceId: workspace.id,
      planId: freePlan.id,
      status: 'trial',
      billingCycle: 'monthly',
      // Mesmo instante de workspaces.trial_ends_at: now() é fixo na transação.
      trialEndsAt: trialEndsAtSql,
      pendingPlanKey,
    });

    return { workspaceId: workspace.id, memberId, slug: workspace.slug, created: true };
  });
}

/** Termos aceitos no cadastro: os dois campos juntos, ou nenhum. */
function resolveTerms(
  input: ProvisionWorkspaceInput,
): { acceptedAt: Date; version: string } | null {
  const { termsAcceptedAt, termsVersion } = input;
  if (termsAcceptedAt === undefined && termsVersion === undefined) return null;
  const version = termsVersion?.trim();
  if (!termsAcceptedAt || Number.isNaN(termsAcceptedAt.getTime()) || !version) {
    throw new Error('termsAcceptedAt e termsVersion vão juntos (data válida e versão não vazia).');
  }
  if (version.length > 64) throw new Error('termsVersion passa de 64 caracteres.');
  return { acceptedAt: termsAcceptedAt, version };
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
