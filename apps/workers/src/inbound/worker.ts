/**
 * Worker inbound (F1-S04) — composição (LIVECHAT.md §1/§3).
 *
 * ```
 * consume hm.q.inbound → valida Envelope (Zod, em `consume`)
 *   → parsePayload (provider + raw)               [InboundMessagePayload]
 *   → runInboundPipeline (parse → media → persist)
 *   → ack/nack
 * ```
 *
 * `consume` de `@hm/shared/mq` já valida o `Envelope`, faz `ack` em sucesso e
 * `nack(requeue=false)→DLX` se o handler lançar. Erros de **conteúdo** (payload
 * malformado, provider desconhecido, raw sem mensagens) NÃO lançam: logam-warn e
 * ack'am (reprocessar um payload imutável não ajuda). Só erros de **infra**
 * (publish/enqueue) propagam para nack→DLX.
 *
 * O envelope chega da borda do webhook (F1-S02) com `workspaceId` = NIL UUID
 * (`UNRESOLVED_WORKSPACE_ID`): a resolução real channel→workspace é do consumer
 * DB-owner downstream, a partir das routing hints do raw.
 */
import { z } from 'zod';
import { connectMq, consume, QUEUES, type Envelope } from '@hm/shared/mq';
import { CHANNEL_PROVIDERS } from '@hm/shared';
import type { Logger } from '@hm/logger';
import { runInboundPipeline } from './pipeline';
import type { InboundDeps } from './ports';

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
    await handleInboundEnvelope(envelope, options);
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
