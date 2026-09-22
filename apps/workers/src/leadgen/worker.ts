/**
 * Consumer de `hm.q.leadgen` (F69-S03).
 *
 * Fila confiável: erro que sobe do processamento vira retry com espera crescente e,
 * esgotado, DLQ — onde o monitor alerta. Payload inválido não sobe: reprocessar um
 * envelope malformado não o conserta, então é descartado com aviso no log.
 */
import { z } from 'zod';
import { GraphClient } from '@hm/channels';
import { connectMq, consume, QUEUES, type MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { MqInboundSocketEmit } from '../inbound/db-ports';
import { DbLeadStore } from './db-store';
import { GraphLeadSource } from './graph-source';
import { processLeadgenJob } from './process';
import type { LeadgenDeps, LeadgenJob } from './ports';

type MqChannel = MqHandle['channel'];

export const LEADGEN_QUEUE = QUEUES.leadgen;

const jobSchema = z.object({
  leadgenId: z.string().min(1).max(64),
  pageId: z.string().min(1).max(64),
  formId: z.string().min(1).max(64).nullable(),
  adId: z.string().min(1).max(64).nullable(),
  origin: z.enum(['webhook', 'reconciliation']),
});

export function parseLeadgenJob(payload: unknown): LeadgenJob | null {
  const r = jobSchema.safeParse(payload);
  return r.success ? r.data : null;
}

export function createLeadgenDeps(channel: MqChannel, logger: Logger): LeadgenDeps {
  return {
    store: new DbLeadStore(),
    source: new GraphLeadSource(new GraphClient()),
    socket: new MqInboundSocketEmit(channel),
    logger,
  };
}

export interface LeadgenWorkerHandle {
  stop(): Promise<void>;
}

export async function startLeadgenWorker(options: {
  readonly deps: LeadgenDeps;
  readonly logger: Logger;
}): Promise<LeadgenWorkerHandle> {
  const { logger, deps } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(LEADGEN_QUEUE, { durable: true });
  // Cada lead faz até três chamadas à Meta. Quatro em paralelo cabem folgado no
  // limite de chamadas por página e ainda entregam uma rajada de campanha em segundos.
  await channel.prefetch(4);

  await consume(channel, LEADGEN_QUEUE, async (envelope) => {
    const job = parseLeadgenJob(envelope.payload);
    if (job === null) {
      logger.warn('leadgen.payload_invalido', { envelopeId: envelope.id, type: envelope.type });
      return;
    }
    await processLeadgenJob(job, deps);
  });

  logger.info('leadgen worker iniciado', { queue: LEADGEN_QUEUE });
  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
    },
  };
}
