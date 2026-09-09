/**
 * Portão de consentimento do worker outbound (F59-S05 — AGENCIA_PLAN §4.4).
 *
 * Carrega, sob RLS, o que a decisão precisa — mercado do workspace, contato e
 * fuso dele, estado de registro do canal e snapshot de consentimento — e delega
 * a `decideOutbound` (`@hm/shared`), que é pura.
 *
 * A regra NÃO mora aqui. Este arquivo é I/O. Quem quiser afrouxar a conformidade
 * teria que mexer em `@hm/shared/consent.ts`, onde 22 testes olham.
 *
 * Nota de arquitetura: o carregamento é parecido com o de
 * `apps/api/src/services/consent`. A duplicação é deliberada — `@hm/workers` não
 * pode depender de `@hm/api` — e é pequena (uma consulta). O que NÃO se duplica é
 * a regra. Consolidar o carregador em `@hm/db` é candidato a slot de limpeza;
 * está anotado em `tasks/COMMS.md`.
 */
import { eq } from 'drizzle-orm';
import { consentRepo, schema, withWorkspace } from '@hm/db';
import {
  decideOutbound,
  isMarketCode,
  type ChannelKind,
  type ChannelProvider,
  type ChannelRegistrationStatus,
  type MarketCode,
  type OutboundDecision,
} from '@hm/shared';
import type { ConsentCheckInput, ConsentGatePort } from './ports';

/** Recusa usada quando o contexto não existe — decisão, nunca exceção. */
function recusaPorContextoAusente(motivo: string): OutboundDecision {
  return {
    allowed: false,
    reason: 'suppressed',
    message: `${motivo} — envio recusado por segurança.`,
    usedFallbackTimezone: true,
    timezone: 'UTC',
  };
}

/**
 * `ChannelProvider` já é um `ChannelKind` válido (a trava de compilação em
 * `markets.ts` garante). A conversão existe só para nomear a intenção.
 */
function asChannelKind(provider: ChannelProvider): ChannelKind {
  return provider;
}

/**
 * Portão real, apoiado no banco.
 *
 * `channelRegistration` é resolvido pelo chamador quando o canal exige registro
 * externo (10DLC). Os canais de hoje (Meta/WAHA) não exigem, então o default
 * `none` é correto e não trava nada — quando o SMS entrar (F60-F), quem resolve
 * o canal passa o estado real.
 */
export function createConsentGate(options?: {
  readonly resolveRegistration?: (
    workspaceId: string,
    provider: ChannelProvider,
  ) => Promise<ChannelRegistrationStatus>;
}): ConsentGatePort {
  return {
    async check(input: ConsentCheckInput): Promise<OutboundDecision> {
      const channel = asChannelKind(input.provider);

      const registration: ChannelRegistrationStatus =
        options?.resolveRegistration === undefined
          ? 'none'
          : await options.resolveRegistration(input.workspaceId, input.provider);

      return withWorkspace(input.workspaceId, async (tx) => {
        const [conversa] = await tx
          .select({ contactId: schema.conversations.contactId })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, input.conversationId))
          .limit(1);

        if (!conversa?.contactId) {
          return recusaPorContextoAusente('Conversa sem contato associado');
        }

        const [ws] = await tx
          .select({ market: schema.workspaces.market })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, input.workspaceId))
          .limit(1);

        const [contato] = await tx
          .select({ timezone: schema.contacts.timezone })
          .from(schema.contacts)
          .where(eq(schema.contacts.id, conversa.contactId))
          .limit(1);

        if (!ws || !contato) {
          return recusaPorContextoAusente('Workspace ou contato não encontrado');
        }

        // Mercado corrompido cai no default da coluna, não estoura o envio.
        const market: MarketCode = isMarketCode(ws.market) ? ws.market : 'BR';

        const consent = await consentRepo.getSnapshot(tx, {
          workspaceId: input.workspaceId,
          contactId: conversa.contactId,
          channel,
          purpose: input.purpose,
        });

        return decideOutbound({
          market,
          channel,
          purpose: input.purpose,
          consent,
          contactTimezone: contato.timezone ?? null,
          channelRegistration: registration,
          now: input.now ?? new Date(),
        });
      });
    },
  };
}

/**
 * Portão que libera tudo. Existe para teste e para composições que ainda não
 * injetam o real — **nunca** deve ser usado em produção, e o nome diz isso.
 */
export const allowAllConsentGate: ConsentGatePort = {
  async check(): Promise<OutboundDecision> {
    return { allowed: true, usedFallbackTimezone: false, timezone: 'UTC' };
  },
};
