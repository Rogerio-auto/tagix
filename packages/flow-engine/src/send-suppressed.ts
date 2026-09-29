/**
 * Envio de flow suprimido (F70-S34). Arquivo sem infra de propósito: o dispatcher (núcleo
 * puro da engine) importa daqui, e quem lança é o ponto de envio do worker
 * (`apps/workers/src/flows/outbound-publisher.ts`). A regra de QUANDO suprimir mora em
 * `quick-replies.ts`.
 */

/**
 * O envio de um flow foi recusado porque o contato recusou a automação. Não é falha do
 * flow: o dispatcher CANCELA a execução com este motivo (nenhum passo seguinte roda, nenhum
 * lembrete sai depois) em vez de marcá-la `failed`.
 */
export class FlowSendSuppressedError extends Error {
  override readonly name = 'FlowSendSuppressedError';
  constructor(
    readonly reason: 'contact_declined',
    readonly conversationId: string,
  ) {
    super(`envio de flow suprimido (${reason}) na conversa ${conversationId}`);
  }
}

/** `instanceof` com fallback pelo nome (o erro atravessa pacotes do monorepo). */
export function isFlowSendSuppressedError(err: unknown): err is FlowSendSuppressedError {
  return (
    err instanceof FlowSendSuppressedError ||
    (err instanceof Error && err.name === 'FlowSendSuppressedError' && 'reason' in err)
  );
}
