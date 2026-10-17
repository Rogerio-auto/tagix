/**
 * Perfil do negócio (F73-S11; A10): cinco chaves fixas, cada uma ≤ 500 caracteres, escritas
 * pela equipe. O conteúdo vai inteiro para o prompt de todo turno (`listActiveForPrompt`), então
 * mudar ou apagar uma chave vale na próxima pergunta de qualquer pessoa.
 *
 * Nada é apagado: o valor antigo vira `superseded` (troca) ou `forgotten` (chave limpa). A
 * trilha (`copilot.memory.profile_updated`) guarda só QUAIS chaves mudaram, nunca o texto.
 */
import { and, eq, sql } from 'drizzle-orm';
import { copilotMemoryRepo, schema, type DbTx } from '@hm/db';
import {
  COPILOT_MEMORY_PROFILE_KEYS,
  MemoryProfileSchema,
  type CopilotMemoryProfileKey,
  type MemoryProfile,
  type MemoryProfileUpdate,
} from '@hm/shared';
import { memberRefs, recordMemoryAudit, sourceLabelMember, type AuditContext } from './common';

/** Perfil completo: sempre as 5 chaves, na ordem fixa; chave vazia = `content: null`. */
export async function loadProfile(tx: DbTx, workspaceId: string): Promise<MemoryProfile> {
  const rows = await copilotMemoryRepo.listProfile(tx, workspaceId);
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.profileKey) byKey.set(r.profileKey, r);
  const refs = await memberRefs(
    tx,
    rows.map((r) => r.createdBy),
  );
  return MemoryProfileSchema.parse({
    entries: COPILOT_MEMORY_PROFILE_KEYS.map((key) => {
      const row = byKey.get(key);
      return {
        key,
        content: row?.content ?? null,
        updated_at: row ? row.updatedAt.toISOString() : null,
        updated_by: (row?.createdBy ? refs.get(row.createdBy) : undefined) ?? null,
      };
    }),
  });
}

export interface ProfileUpdateResult {
  readonly changed: readonly CopilotMemoryProfileKey[];
  readonly cleared: readonly CopilotMemoryProfileKey[];
}

/**
 * Aplica o PUT parcial: só as chaves enviadas mudam; texto vazio limpa a chave; texto igual ao
 * atual não faz nada (nem trilha). `update` já passou por `MemoryProfileUpdateSchema` (≤ 500).
 */
export async function updateProfile(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly memberName: string;
    readonly update: MemoryProfileUpdate;
    readonly audit?: AuditContext;
  },
): Promise<ProfileUpdateResult> {
  const { workspaceId } = input;
  const m = schema.copilotMemoryEntries;
  const current = new Map<string, string>();
  for (const r of await copilotMemoryRepo.listProfile(tx, workspaceId)) {
    if (r.profileKey) current.set(r.profileKey, r.content);
  }
  const changed: CopilotMemoryProfileKey[] = [];
  const cleared: CopilotMemoryProfileKey[] = [];

  for (const key of COPILOT_MEMORY_PROFILE_KEYS) {
    const raw = input.update[key];
    if (raw === undefined) continue;
    const content = raw.trim();
    const before = current.get(key);
    if (content === '') {
      if (before === undefined) continue;
      // Mesmo lock do repo: a limpeza não corre com um upsert da mesma chave.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`copilot_profile:${workspaceId}:${key}`}, 0))`,
      );
      await tx
        .update(m)
        .set({
          status: 'forgotten',
          forgottenBy: input.memberId,
          forgottenAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(m.workspaceId, workspaceId),
            eq(m.kind, 'profile'),
            eq(m.profileKey, key),
            eq(m.status, 'active'),
          ),
        );
      cleared.push(key);
      changed.push(key);
      continue;
    }
    if (before === content) continue;
    await copilotMemoryRepo.upsertProfile(tx, {
      workspaceId,
      key,
      content,
      sourceType: 'member',
      sourceLabel: sourceLabelMember(input.memberName),
      createdBy: input.memberId,
    });
    changed.push(key);
  }

  if (changed.length > 0) {
    await recordMemoryAudit(tx, {
      workspaceId,
      actorMemberId: input.memberId,
      action: 'copilot.memory.profile_updated',
      resourceId: null,
      metadata: { keys: changed, cleared },
      ...(input.audit ? { audit: input.audit } : {}),
    });
  }
  return { changed, cleared };
}
