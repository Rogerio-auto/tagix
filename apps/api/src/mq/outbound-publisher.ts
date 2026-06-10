/**
 * Publisher de jobs outbound a partir da API (LIVECHAT.md §3.1/§3.2).
 *
 * A borda da API persiste a mensagem em estado `pending` e enfileira o envio
 * real em `hm.q.outbound`. O worker outbound consome essa fila, valida o payload
 * com `parseOutboundJob` (Zod) e dispara ao provider. Aqui só publicamos um
 * `OutboundJob` já no shape exato do worker — qualquer divergência falharia o
 * `parseOutboundJob` (nack sem requeue), então o contrato é mantido em sincronia.
 *
 * Topologia: `hm.q.outbound` é bind ao exchange `hm.events` com `hm.q.outbound.#`
 * (ver `assertTopology`). Publicamos via exchange com routing key `hm.q.outbound.send`,
 * o mesmo padrão do publisher de webhooks (`routes/webhooks/publisher.ts`).
 *
 * Usa um canal RabbitMQ lazy e compartilhado por processo; reconecta se cair.
 */
import { connectMq, makeEnvelope, publish, QUEUES, type MqHandle } from '@hm/shared/mq';

/** Tipo do envelope publicado (routing key bind: `hm.q.outbound.#`). */
export const OUTBOUND_JOB_TYPE = 'outbound.job' as const;
const OUTBOUND_ROUTING_KEY = `${QUEUES.outbound}.send`;

let handlePromise: Promise<MqHandle> | null = null;

async function getHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    // Falha ao conectar: limpa o cache para a próxima tentativa reconectar.
    handlePromise = null;
    throw err;
  }
}

/**
 * Publica um `OutboundJob` no exchange de eventos para `hm.q.outbound`.
 *
 * `job` chega tipado como `unknown` de propósito: o módulo do job vive em
 * `apps/workers` (fora do grafo de imports da API), então a fonte da verdade do
 * shape é o `parseOutboundJob` do worker. O caller monta o shape exato; aqui só
 * serializamos. Retorna `false` se o broker aplicou backpressure (buffer cheio).
 */
export async function publishOutboundJob(workspaceId: string, job: unknown): Promise<boolean> {
  const { channel } = await getHandle();
  const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, workspaceId, job);
  return publish(channel, OUTBOUND_ROUTING_KEY, envelope);
}

/** Encerra o canal/conn (testes / shutdown). */
export async function closeOutboundPublisher(): Promise<void> {
  if (!handlePromise) return;
  const pending = handlePromise;
  handlePromise = null;
  try {
    const { connection } = await pending;
    await connection.close();
  } catch {
    // já caiu — nada a fazer
  }
}
