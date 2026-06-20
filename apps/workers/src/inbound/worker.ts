/**
 * Worker inbound (F1-S04 → refatorado em F1-S26) — composição
 * (LIVECHAT.md §1/§3, ARCHITECTURE.md §4.2).
 *
 * ```
 * consume hm.q.inbound → valida Envelope (Zod, em `consume`)
 *   → parsePayload (provider + raw)               [InboundMessagePayload]
 *   → runInboundPipeline (parse → media → PERSIST in-process via @hm/db)
 *   → ack/nack
 * ```
 *
 * `consume` de `@hm/shared/mq` já valida o `Envelope`, faz `ack` em sucesso e
 * `nack(requeue=false)→DLX` se o handler lançar. Erros de **conteúdo** (payload
 * malformado, provider desconhecido, raw sem mensagens, canal órfão) NÃO lançam:
 * logam-warn e ack'am (reprocessar um payload imutável não ajuda). Só erros de
 * **infra** (DB/socket/enqueue) propagam para nack→DLX.
 *
 * O envelope chega da borda do webhook (F1-S02) com `workspaceId` = NIL UUID
 * (`UNRESOLVED_WORKSPACE_ID`): a resolução real channel→workspace acontece na
 * persistência (`DbInboundPersistence`), a partir das routing hints do raw.
 */
import { z } from 'zod';
import { connectMq, consume, QUEUES, type Envelope, type MqHandle } from '@hm/shared/mq';
import { CHANNEL_PROVIDERS } from '@hm/shared';
import { parseWhatsAppWebhook, parseWahaWebhook, parseInstagramWebhook } from '@hm/channels';
import type { Logger } from '@hm/logger';
import { runInboundPipeline } from './pipeline';
import { ChannelInboundParser } from './parse';
import { createStatusDeps } from './status';
import { DbInboundPersistence, MqInboundFlowEnqueue, MqInboundSocketEmit } from './db-ports';
import { MqMediaEnqueue } from './mq-ports';
import {
  createCampaignInboundPorts,
  processCampaignInbound,
} from '../campaigns-inbound/index';
import type { InboundDeps } from './ports';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila canônica de inbound (`QUEUES.inbound`). */
export const INBOUND_QUEUE = QUEUES.inbound;

/**
 * Workspace ainda não resolvido na borda — o consumer DB-owner resolve a partir
 * das routing hints. Espelha `UNRESOLVED_WORKSPACE_ID` da borda do webhook
 * (`apps/api/src/routes/webhooks/publisher.ts`); duplicado aqui porque o worker
 * não importa de `apps/api`. NIL UUID.
 */
export const UNRESOLVED_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Shape do `payload` do envelope `inbound.message` publicado pela borda
 * (F1-S02): `{ provider, raw }`. Validado no boundary (proibido `any`).
 */
const inboundMessagePayloadSchema = z.object({
  provider: z.enum(CHANNEL_PROVIDERS),
  raw: z.unknown(),
});

export interface InboundWorkerOptions {
  readonly deps: InboundDeps;
  readonly logger: Logger;
}

import { createTriggerDispatchDeps, dispatchTriggersForNewMessage } from '../flows-triggers/index';

/**
 * Monta as dependências default do worker inbound a partir da infra real
 * (F1-S26). Parser default (WA/WAHA reais de `@hm/channels`, IG placeholder),
 * persistência DIRETA `@hm/db`+RLS (`DbInboundPersistence`) com socket relay
 * (`message:new`/`typing:from_contact`), status (S20) e flow enqueue (STUB), e
 * enfileiramento de mídia via `hm.q.media`. O `channel` AMQP é o do consumer.
 */
export function createInboundDeps(channel: MqChannel, logger: Logger): InboundDeps {
  const parser = new ChannelInboundParser(
    { metaWhatsApp: parseWhatsAppWebhook, waha: parseWahaWebhook, metaInstagram: parseInstagramWebhook },
    logger,
  );
  const socket = new MqInboundSocketEmit(channel);
  const flow = new MqInboundFlowEnqueue(channel);
  const statusDeps = createStatusDeps(channel);
  // Hook de trigger dispatch de flows (F4-S13): avalia/dispara flows + resume waiting.
  const triggerDeps = createTriggerDispatchDeps(logger);
  // Campaigns-inbound (F6-S07): opt-out por keyword + reply handling/handoff/followup.
  const campaignInboundPorts = createCampaignInboundPorts({ channel, logger });
  const contactMessageHook = {
    async onContactMessage(input: {
      workspaceId: string;
      conversationId: string;
      contactId: string | null;
      channelId: string;
      messageId: string;
      type: string;
      content: string | null;
    }): Promise<void> {
      await dispatchTriggersForNewMessage(triggerDeps, {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        channelId: input.channelId,
        content: input.content,
        type: input.type,
        fromContact: true,
      });
      // So mensagens text com contato resolvido entram no processor de campanhas.
      if (input.contactId && input.type === 'text') {
        try {
          await processCampaignInbound(
            {
              workspaceId: input.workspaceId,
              channelId: input.channelId,
              contactId: input.contactId,
              conversationId: input.conversationId,
              text: input.content,
            },
            { ports: campaignInboundPorts, logger },
          );
        } catch (err: unknown) {
          // Falha aqui nao derruba a persistencia inbound.
          logger.error('inbound: campaign-inbound hook falhou', {
            conversationId: input.conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  };
  const persistence = new DbInboundPersistence(
    socket,
    flow,
    statusDeps,
    logger,
    undefined,
    contactMessageHook,
  );
  const media = new MqMediaEnqueue(channel);
  return { parser, persistence, media };
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Lança apenas em falha de
 * infra (publish/enqueue dentro do pipeline) — o caller (`consume`) converte em
 * nack. Conteúdo inválido loga-warn e retorna sem lançar.
 */
export async function handleInboundEnvelope(
  envelope: Envelope,
  options: InboundWorkerOptions,
): Promise<void> {
  const { deps, logger } = options;

  const parsed = inboundMessagePayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    logger.warn('inbound: payload de envelope inválido — descartado', {
      envelopeId: envelope.id,
      type: envelope.type,
    });
    return;
  }

  const { provider, raw } = parsed.data;
  await runInboundPipeline(provider, raw, deps, logger);
}

export interface InboundWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Inicia o consumer de `hm.q.inbound`. Conecta ao RabbitMQ, garante a fila e
 * registra o handler. Retorna um handle para parada limpa.
 */
export async function startInboundWorker(
  options: InboundWorkerOptions,
): Promise<InboundWorkerHandle> {
  const { logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(INBOUND_QUEUE, { durable: true });
  await channel.prefetch(16);

  await consume(channel, INBOUND_QUEUE, async (envelope) => {
    try {
      await handleInboundEnvelope(envelope, options);
    } catch (err: unknown) {
      // Diagnóstico: o `consume` nack→descarta sem logar (DLX sem consumer). Sem
      // este log, uma exceção na persistência some silenciosamente (0 mensagens,
      // 0 log). Logamos o motivo real e re-lançamos (mantém o nack).
      logger.error('inbound: handler lançou — mensagem nack/descartada', {
        envelopeId: envelope.id,
        type: envelope.type,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  });

  logger.info('inbound worker iniciado', { queue: INBOUND_QUEUE });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('inbound worker parado', { queue: INBOUND_QUEUE });
    },
  };
}
