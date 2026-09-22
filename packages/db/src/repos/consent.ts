/**
 * Repositório de consentimento e supressão (F59-S03 — AGENCIA_PLAN.md §4.4).
 *
 * Toda função roda sob a transação recebida, ou seja, sob RLS: quem chama já
 * entrou em `withWorkspace`. Não há caminho aqui que leia sem contexto de tenant.
 *
 * A leitura que o caminho de envio usa é `getConsentSnapshot`: uma consulta só,
 * devolvendo supressão + consentimento do canal. O portão (`decideOutbound`,
 * F59-S04) é puro e recebe esse snapshot — o I/O fica aqui, a decisão fica lá.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { DbTx } from '../client';
import {
  contactConsents,
  contactSuppressions,
  type ConsentChannel,
  type ConsentProof,
  type ConsentPurpose,
  type ContactConsent,
} from '../schema/consent';

/** Tudo que o portão precisa saber para decidir, num objeto só. */
export interface ConsentSnapshot {
  /** Supressão da empresa inteira — vence qualquer consentimento de canal. */
  readonly suppressedGlobally: boolean;
  /** Supressão específica deste canal. */
  readonly suppressedOnChannel: boolean;
  /** `granted` só quando existe registro explícito; ausência é `never`. */
  readonly marketingStatus: 'granted' | 'revoked' | 'never';
  readonly grantedAt: Date | null;
}

export interface GrantConsentInput {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly channel: ConsentChannel;
  readonly purpose: ConsentPurpose;
  readonly source: string;
  readonly proof: ConsentProof;
  readonly market: 'BR' | 'US';
  readonly capturedBy?: string | null;
}

export interface RevokeConsentInput {
  readonly workspaceId: string;
  readonly contactId: string;
  /** `null` revoga na empresa inteira — o escopo que a regra de 2027 exige. */
  readonly channel: ConsentChannel | null;
  readonly reason: string;
  readonly evidence?: Record<string, unknown>;
}

export const consentRepo = {
  /**
   * Snapshot para o caminho de envio. Uma consulta, sem N+1 — este código roda
   * por destinatário em disparo de campanha.
   */
  async getSnapshot(
    tx: DbTx,
    input: {
      workspaceId: string;
      contactId: string;
      channel: ConsentChannel;
      purpose: ConsentPurpose;
    },
  ): Promise<ConsentSnapshot> {
    const [suppressions, consents] = await Promise.all([
      tx
        .select({ channel: contactSuppressions.channel })
        .from(contactSuppressions)
        .where(
          and(
            eq(contactSuppressions.workspaceId, input.workspaceId),
            eq(contactSuppressions.contactId, input.contactId),
            or(
              isNull(contactSuppressions.channel),
              eq(contactSuppressions.channel, input.channel),
            ),
          ),
        ),
      tx
        .select()
        .from(contactConsents)
        .where(
          and(
            eq(contactConsents.workspaceId, input.workspaceId),
            eq(contactConsents.contactId, input.contactId),
            eq(contactConsents.channel, input.channel),
            eq(contactConsents.purpose, input.purpose),
          ),
        )
        .limit(1),
    ]);

    const consent: ContactConsent | undefined = consents[0];

    return {
      suppressedGlobally: suppressions.some((s) => s.channel === null),
      suppressedOnChannel: suppressions.some((s) => s.channel === input.channel),
      marketingStatus: consent?.status ?? 'never',
      grantedAt: consent?.grantedAt ?? null,
    };
  },

  /**
   * Registra consentimento. Upsert pelo escopo único
   * `(workspace, contato, canal, finalidade)` — reconsentir depois de revogar é
   * legítimo e não deve criar linha órfã.
   */
  async grant(tx: DbTx, input: GrantConsentInput): Promise<void> {
    const now = new Date();
    await tx
      .insert(contactConsents)
      .values({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        channel: input.channel,
        purpose: input.purpose,
        status: 'granted',
        source: input.source,
        proof: input.proof,
        market: input.market,
        capturedBy: input.capturedBy ?? null,
        grantedAt: now,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: [
          contactConsents.workspaceId,
          contactConsents.contactId,
          contactConsents.channel,
          contactConsents.purpose,
        ],
        set: {
          status: 'granted',
          source: input.source,
          proof: input.proof,
          market: input.market,
          capturedBy: input.capturedBy ?? null,
          grantedAt: now,
          revokedAt: null,
          updatedAt: now,
        },
      });
  },

  /**
   * Revoga e SUPRIME. As duas coisas juntas de propósito: revogar sem suprimir
   * deixaria o contato passar pelo portão até alguém lembrar de criar a supressão.
   *
   * A lei americana dá 10 dias úteis para honrar. Honramos no primeiro segundo —
   * provar que honrou no nono é mais caro que honrar agora.
   */
  async revoke(tx: DbTx, input: RevokeConsentInput): Promise<void> {
    const now = new Date();

    await tx
      .insert(contactSuppressions)
      .values({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        channel: input.channel,
        reason: input.reason,
        evidence: input.evidence ?? {},
      })
      .onConflictDoNothing();

    const scope = and(
      eq(contactConsents.workspaceId, input.workspaceId),
      eq(contactConsents.contactId, input.contactId),
      input.channel === null ? undefined : eq(contactConsents.channel, input.channel),
    );

    await tx
      .update(contactConsents)
      .set({ status: 'revoked', revokedAt: now, updatedAt: now })
      .where(scope);
  },

  /** Verificação isolada de supressão, para uso fora do caminho de envio. */
  async isSuppressed(
    tx: DbTx,
    input: { workspaceId: string; contactId: string; channel: ConsentChannel },
  ): Promise<boolean> {
    const rows = await tx
      .select({ n: sql<number>`1` })
      .from(contactSuppressions)
      .where(
        and(
          eq(contactSuppressions.workspaceId, input.workspaceId),
          eq(contactSuppressions.contactId, input.contactId),
          or(isNull(contactSuppressions.channel), eq(contactSuppressions.channel, input.channel)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },
};
