/**
 * Enfileiramento de leads de anúncios na borda do webhook (F69-S03).
 *
 * A borda só enfileira: a busca do lead na Meta leva segundos e a Meta exige resposta
 * do webhook em menos de 5. Um envelope por `leadgen_id`, com o workspace ainda não
 * resolvido — o worker resolve a página para os workspaces que recebem dela.
 */
import {
  connectMq,
  LEADGEN_EVENT_TYPE,
  LEADGEN_ROUTING_KEY,
  makeEnvelope,
  publish,
  type MqHandle,
} from '@hm/shared/mq';
import type { LeadgenNotification } from '@hm/channels';

const UNRESOLVED_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

/** Mesmo teto da borda do inbound: falhar rápido e deixar a Meta reentregar. */
const PUBLISH_TIMEOUT_MS = 3000;

let handlePromise: Promise<MqHandle> | null = null;

async function getHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

/**
 * Publica um lead. `false` = backpressure do broker. Lança em timeout ou conexão
 * caída. Nos dois casos a borda responde 5xx e a Meta reentrega — e a duplicata que
 * isso pode gerar é absorvida pelo worker, que reserva o lead por `leadgen_id`.
 */
export async function publishLeadgen(n: LeadgenNotification): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`leadgen enqueue timed out after ${PUBLISH_TIMEOUT_MS}ms`)), PUBLISH_TIMEOUT_MS);
    timer.unref();
  });
  try {
    return await Promise.race([
      (async () => {
        const { channel } = await getHandle();
        const envelope = makeEnvelope(LEADGEN_EVENT_TYPE, UNRESOLVED_WORKSPACE_ID, {
          leadgenId: n.leadgenId,
          pageId: n.pageId,
          formId: n.formId,
          adId: n.adId,
          origin: 'webhook' as const,
        });
        return publish(channel, LEADGEN_ROUTING_KEY, envelope);
      })(),
      guard,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
