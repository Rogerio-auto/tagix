/**
 * Passo de revogação do inbound (F59-S06 — AGENCIA_PLAN.md §4.1).
 *
 * A regra americana em vigor desde 11/04/2025: o consumidor revoga por qualquer
 * meio razoável, e não se pode exigir palavra-chave. Aqui a mensagem recebida é
 * lida por `detectRevocation` (`@hm/shared`, puro, 48 testes) e, quando é pedido
 * de parada, a supressão é gravada **na hora**. A lei dá 10 dias úteis; provar
 * que honrou no nono é mais caro que honrar no primeiro segundo.
 *
 * **Custo:** a detecção é determinística e roda em memória. O banco só é tocado
 * quando algo foi detectado — o caminho comum (conversa normal) não paga nada.
 *
 * **Efeito sobre o agente:** a supressão entra antes de qualquer resposta sair,
 * e o portão do outbound (F59-S05) recusa envio a contato suprimido, inclusive
 * transacional. Ou seja: o agente pode até formular uma resposta, mas ela não é
 * entregue. Bloquear a formulação exigiria mexer no gatilho do agente, que é de
 * outro slot — está anotado em `tasks/COMMS.md`.
 */
import { and, eq } from 'drizzle-orm';
import { consentRepo, schema, withWorkspace } from '@hm/db';
import type { InboundEvent } from '@hm/channels';
import type { Logger } from '@hm/logger';
import {
  actionFor,
  detectRevocation,
  getOutboundPolicy,
  isMarketCode,
  type ChannelKind,
  type MarketCode,
  type RevocationDetection,
} from '@hm/shared';
import { getMeter } from '@hm/logger';
import type { ChannelProvider } from '@hm/shared';
import type { InboundChannelResolver } from './db-ports';
import type { RoutingHints } from './ports';

const meter = getMeter('@hm/workers');
const detectedCounter = meter.createCounter('hm.revocation.detected', {
  description: 'Pedidos de revogação detectados no inbound, por camada e ação.',
});

export interface RevocationOutcome {
  /** Quantas mensagens viraram supressão imediata. */
  readonly suppressed: number;
  /** Quantas ficaram marcadas para revisão humana (confiança intermediária). */
  readonly flagged: number;
}

const NADA: RevocationOutcome = { suppressed: 0, flagged: 0 };

export interface RevocationPort {
  handle(
    provider: ChannelProvider,
    routing: RoutingHints,
    events: readonly InboundEvent[],
    logger: Logger,
  ): Promise<RevocationOutcome>;
}

/** Texto de uma mensagem inbound, quando houver. */
function textoDe(event: InboundEvent): string | null {
  if (event.type !== 'message') return null;
  const c = event.content;
  return typeof c === 'string' && c.trim().length > 0 ? c : null;
}

/**
 * Passo real. Recebe o resolver de canal já existente (`DbInboundChannelResolver`)
 * para não duplicar a resolução `routing hints → canal → workspace`.
 */
export function createRevocationStep(channels: InboundChannelResolver): RevocationPort {
  return {
    async handle(
      provider: ChannelProvider,
      routing: RoutingHints,
      events: readonly InboundEvent[],
      logger: Logger,
    ): Promise<RevocationOutcome> {
      // Passada barata: nada de I/O enquanto nada foi detectado.
      const candidatos: { event: InboundEvent; detection: RevocationDetection }[] = [];
      for (const event of events) {
        const texto = textoDe(event);
        if (texto === null) continue;
        // Palavras-chave dependem do mercado, que exige o canal. Para a primeira
        // passada usamos as do pack BR — o conjunto é bilíngue e idêntico nos dois
        // mercados por desenho, então isto não muda o resultado e evita I/O.
        const kw = getOutboundPolicy('BR', 'meta_whatsapp').optOutKeywords;
        const detection = detectRevocation(texto, kw);
        if (detection.detected) candidatos.push({ event, detection });
      }
      if (candidatos.length === 0) return NADA;

      const resolved = await channels.resolve(provider, routing);
      if (resolved === null) return NADA;

      const { channelId, workspaceId } = resolved;
      let suppressed = 0;
      let flagged = 0;

      await withWorkspace(workspaceId, async (tx) => {
        const [ws] = await tx
          .select({ market: schema.workspaces.market })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, workspaceId))
          .limit(1);
        const market: MarketCode = isMarketCode(ws?.market) ? ws.market : 'BR';

        for (const { event, detection } of candidatos) {
          if (event.type !== 'message') continue;
          const acao = actionFor(detection);
          detectedCounter.add(1, { layer: detection.layer, action: acao, market });

          if (acao === 'ignore') continue;

          const [contato] = await tx
            .select({ id: schema.contacts.id })
            .from(schema.contacts)
            .where(
              and(
                eq(schema.contacts.workspaceId, workspaceId),
                eq(schema.contacts.phone, event.contactRemoteId),
              ),
            )
            .limit(1);

          if (!contato) {
            // Contato ainda não existe (primeira mensagem é o próprio "PARE").
            // A persistência acontece depois neste mesmo pipeline; registrar aqui
            // seria supressão órfã. Fica o log — caso raro e visível.
            logger.warn('inbound: revogação detectada antes de o contato existir', {
              provider,
              channelId,
              layer: detection.layer,
              confidence: detection.confidence,
            });
            continue;
          }

          const evidencia = {
            original: event.content,
            layer: detection.layer,
            confidence: detection.confidence,
            matched: detection.matched,
            externalId: event.externalId,
          };

          if (acao === 'review') {
            // Confiança intermediária não suprime sozinha: notifica e deixa para
            // o humano. Suprimir quem não pediu apaga um cliente do funil sem
            // ninguém perceber.
            flagged += 1;
            logger.warn('inbound: possível revogação — requer revisão humana', {
              provider,
              contactId: contato.id,
              ...evidencia,
            });
            continue;
          }

          await consentRepo.revoke(tx, {
            workspaceId,
            contactId: contato.id,
            // Fala genérica sobre a empresa revoga tudo; pedido sobre as
            // mensagens revoga o canal em que veio.
            channel: detection.scope === 'company' ? null : (provider as ChannelKind),
            reason: detection.layer === 'keyword' ? 'keyword' : 'natural_language',
            evidence: evidencia,
          });
          suppressed += 1;

          logger.warn('inbound: revogação honrada imediatamente', {
            provider,
            contactId: contato.id,
            scope: detection.scope,
            ...evidencia,
          });
        }
      });

      return { suppressed, flagged };
    },
  };
}

/** Passo inerte, para composições e testes que não exercitam revogação. */
export const noopRevocationStep: RevocationPort = {
  async handle(): Promise<RevocationOutcome> {
    return NADA;
  },
};
