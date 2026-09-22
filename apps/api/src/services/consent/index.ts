/**
 * Serviço de consentimento (F59-S04 — AGENCIA_PLAN.md §4.4).
 *
 * Faz o I/O que a função pura `decideOutbound` não faz: carrega o mercado do
 * workspace, o fuso do contato, o estado de registro do canal e o snapshot de
 * consentimento — tudo sob RLS — e delega a decisão.
 *
 * A separação é deliberada: a REGRA (com consequência jurídica) é pura e testável
 * sem banco; o CARREGAMENTO é aqui. Quem quiser mudar a regra mexe em
 * `@hm/shared/consent` e o teste pega; quem mexer aqui não consegue afrouxar a regra.
 */
import { eq } from 'drizzle-orm';
import { consentRepo, schema, withWorkspace, type DbTx } from '@hm/db';
import {
  decideOutbound,
  isMarketCode,
  type ChannelKind,
  type ChannelRegistrationStatus,
  type MarketCode,
  type MessagePurpose,
  type OutboundDecision,
} from '@hm/shared';

export interface OutboundCheckInput {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly channel: ChannelKind;
  readonly purpose: MessagePurpose;
  /**
   * Estado do registro externo do canal (10DLC). Vem de quem conhece o canal —
   * o serviço não adivinha: canal sem registro exigido ignora este valor.
   */
  readonly channelRegistration?: ChannelRegistrationStatus;
  /** Injetável para teste; em produção é o relógio. */
  readonly now?: Date;
}

/** Contexto de tenant necessário para decidir, carregado numa consulta. */
async function loadContext(
  tx: DbTx,
  workspaceId: string,
  contactId: string,
): Promise<{ market: MarketCode; contactTimezone: string | null } | null> {
  const [ws] = await tx
    .select({ market: schema.workspaces.market })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return null;

  const [contact] = await tx
    .select({ timezone: schema.contacts.timezone })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .limit(1);
  if (!contact) return null;

  // Mercado corrompido no banco não vira exceção no caminho de envio: cai no
  // padrão seguro do market pack, e a decisão registra o que usou.
  const market: MarketCode = isMarketCode(ws.market) ? ws.market : 'BR';
  return { market, contactTimezone: contact.timezone ?? null };
}

/**
 * Decide se uma mensagem pode sair para este contato, neste canal, com esta
 * finalidade. Roda a transação sob RLS.
 *
 * Contato ou workspace inexistente é recusa, não exceção — o caminho de envio
 * precisa de decisão, não de stack trace.
 */
export async function checkOutbound(input: OutboundCheckInput): Promise<OutboundDecision> {
  return withWorkspace(input.workspaceId, async (tx) => {
    const ctx = await loadContext(tx, input.workspaceId, input.contactId);
    if (ctx === null) {
      return {
        allowed: false as const,
        reason: 'suppressed' as const,
        message: 'Contato ou workspace não encontrado — envio recusado por segurança.',
        usedFallbackTimezone: true,
        timezone: 'UTC',
      };
    }

    const consent = await consentRepo.getSnapshot(tx, {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channel: input.channel,
      purpose: input.purpose,
    });

    return decideOutbound({
      market: ctx.market,
      channel: input.channel,
      purpose: input.purpose,
      consent,
      contactTimezone: ctx.contactTimezone,
      channelRegistration: input.channelRegistration ?? 'none',
      now: input.now ?? new Date(),
    });
  });
}

/**
 * Versão para quem já está dentro de uma transação com RLS ativa (worker que
 * resolve vários destinatários no mesmo `withWorkspace`). Evita abrir transação
 * por destinatário num disparo de campanha.
 */
export async function checkOutboundInTx(
  tx: DbTx,
  input: OutboundCheckInput,
): Promise<OutboundDecision> {
  const ctx = await loadContext(tx, input.workspaceId, input.contactId);
  if (ctx === null) {
    return {
      allowed: false,
      reason: 'suppressed',
      message: 'Contato ou workspace não encontrado — envio recusado por segurança.',
      usedFallbackTimezone: true,
      timezone: 'UTC',
    };
  }

  const consent = await consentRepo.getSnapshot(tx, {
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    channel: input.channel,
    purpose: input.purpose,
  });

  return decideOutbound({
    market: ctx.market,
    channel: input.channel,
    purpose: input.purpose,
    consent,
    contactTimezone: ctx.contactTimezone,
    channelRegistration: input.channelRegistration ?? 'none',
    now: input.now ?? new Date(),
  });
}
