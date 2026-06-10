/**
 * `presence` — pre-action de indicador de digitação/gravação do outbound
 * (LIVECHAT.md §3.1) + helper de presença inbound.
 *
 * Duas responsabilidades, ambas best-effort (presença é cosmética: nunca deve
 * derrubar o ack de um job nem o processamento de um inbound):
 *
 * 1. **Outbound (pre_action).** Antes de `dispatchOutbound` enviar uma
 *    mensagem real (`text`/`media`/`template`/`interactive`), o worker pode
 *    disparar `adapter.sendTypingIndicator` no provider, espelhando para o
 *    contato a presença "digitando…" que a UI do agente já mostra. Falha do
 *    provider é engolida (warn) — o envio segue.
 *
 * 2. **Inbound (helper de emissão).** Quando o webhook do provider sinaliza que
 *    o CONTATO está digitando/gravando, o inbound worker (outro slot) constrói
 *    o payload `typing:from_contact` e o publica no relay de socket. Este módulo
 *    expõe o helper puro `emitContactPresence` para esse fim — o inbound worker
 *    injeta seu próprio `SocketEmitPort` estendido (ver REPORT de wiring).
 *
 * O worker outbound não fala com adapter/socket diretamente fora destas portas
 * — tudo é injetado, mantendo o módulo testável e dentro da fronteira do slot.
 */
import type { Channel, IChannelAdapter } from '@hm/channels';
import type { ContactPresence, TypingFromContactPayload } from '@hm/shared';
import type { Logger } from '@hm/logger';
import type { OutboundJob } from './job';

/**
 * Kinds de outbound que representam uma mensagem real do agente e, portanto,
 * justificam um indicador de digitação prévio ao contato. `typing_indicator`
 * NÃO se auto-dispara (seria recursivo / redundante).
 */
const PRESENCE_BEFORE_KINDS = new Set<OutboundJob['kind']>([
  'text',
  'media',
  'template',
  'interactive',
]);

/**
 * Resolve o `externalId` alvo do indicador a partir do job. Para os kinds com
 * destinatário direto é o `chatId` (id do contato no provider). Jobs sem
 * destinatário endereçável retornam `undefined` (pré-ação é pulada).
 */
function targetForPresence(job: OutboundJob): string | undefined {
  switch (job.kind) {
    case 'text':
    case 'media':
    case 'template':
    case 'interactive':
      return job.chatId;
    case 'typing_indicator':
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Pre-action de presença do outbound. Dispara `sendTypingIndicator` no provider
 * ANTES do envio real, espelhando "digitando…" ao contato.
 *
 * Contrato:
 * - Best-effort: qualquer erro do adapter é logado em `warn` e engolido — o
 *   caller (dispatch) deve prosseguir com o envio independentemente.
 * - No-op silencioso para kinds que não são mensagem real (`typing_indicator`)
 *   ou sem destinatário endereçável.
 * - `presence` default é `'typing'`; o caller pode pedir `'recording'` (ex.:
 *   job de áudio/voz) quando fizer sentido.
 *
 * @returns `true` se um indicador foi efetivamente disparado ao provider.
 */
export async function runPresencePreAction(
  job: OutboundJob,
  channel: Channel,
  adapter: IChannelAdapter,
  logger: Logger,
  presence: ContactPresence = 'typing',
): Promise<boolean> {
  if (!PRESENCE_BEFORE_KINDS.has(job.kind)) return false;

  const target = targetForPresence(job);
  if (target === undefined || target.length === 0) return false;

  try {
    await adapter.sendTypingIndicator(target, presence, channel);
    return true;
  } catch (err) {
    logger.warn('outbound: pre-action de presença falhou (ignorado)', {
      kind: job.kind,
      conversationId: job.conversationId,
      provider: channel.provider,
      presence,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Porta mínima de emissão de presença do contato para o socket. O inbound
 * worker injeta uma implementação (publica no `hm.q.socket.relay`, evento
 * `typing:from_contact`, room `conversation:{id}`), análoga ao `SocketEmitPort`
 * do outbound. Mantida aqui (e não em `ports.ts`, fora do slot) para o helper
 * de inbound ser autocontido.
 */
export interface ContactPresenceEmitPort {
  emitContactPresence(workspaceId: string, payload: TypingFromContactPayload): Promise<void>;
}

/**
 * Helper de emissão de presença do CONTATO (inbound). Recebe o id da conversa
 * + a presença sinalizada pelo webhook e delega à porta de socket. Puro e
 * best-effort: o caller (inbound worker, outro slot) decide engolir falhas.
 *
 * Wiring esperado (ver REPORT): no inbound worker, ao parsear um evento de
 * presença do provider, chamar:
 *
 * ```ts
 * await emitContactPresence(socketPort, workspaceId, conversationId, presence);
 * ```
 */
export async function emitContactPresence(
  port: ContactPresenceEmitPort,
  workspaceId: string,
  conversationId: string,
  presence: ContactPresence,
): Promise<void> {
  const payload: TypingFromContactPayload = { conversationId, presence };
  await port.emitContactPresence(workspaceId, payload);
}
