/**
 * Dependências reais do motor de propostas (F73-S05).
 *
 * - Executores: registro montado a partir de `COPILOT_EXECUTORS` por quem compõe (rotas e
 *   `server.ts`). O motor NÃO importa `internal/copilot/index.ts`: as áreas `act-*` importam
 *   `makeProposeTool` daqui, e o import de volta faria um ciclo.
 * - Socket: `copilot:proposal_updated` pela fila `hm.q.socket.relay` (o mesmo caminho dos demais
 *   eventos da API), uma mensagem por sala `member:<id>`. Best-effort: socket fora do ar nunca
 *   derruba uma confirmação nem uma execução.
 * - Notificação: a cascata existente (`notifyEvent`), evento `copilot_aprovacao`.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import { createLogger } from '@hm/logger';
import { CAPABILITY_KEYS, isWriteCapability, type CapabilityKey } from '@hm/shared';
import type { CapabilityExecutor } from '../../../internal/copilot/core/executor-types';
import { notifyEvent } from '../../notifications';
import type { ExecutorRegistry, ProposalEngineDeps, ProposalUpdateEmitter } from './types';

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITY_KEYS);

/** Monta o registro. Lança no boot com capacidade desconhecida, de consulta ou repetida. */
export function createExecutorRegistry(executors: readonly CapabilityExecutor[]): ExecutorRegistry {
  const byCapability = new Map<string, CapabilityExecutor>();
  for (const executor of executors) {
    const cap = executor.capability;
    if (!CAPABILITY_SET.has(cap)) {
      throw new Error(`copilot executor: capacidade desconhecida '${cap}'.`);
    }
    if (!isWriteCapability(cap as CapabilityKey)) {
      throw new Error(`copilot executor: '${cap}' não é capacidade de escrita.`);
    }
    if (byCapability.has(cap)) throw new Error(`copilot executor: capacidade repetida '${cap}'.`);
    byCapability.set(cap, executor);
  }
  const frozen = Object.freeze([...byCapability.values()]);
  return { get: (capability) => byCapability.get(capability), list: () => frozen };
}

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

let handlePromise: Promise<MqHandle> | null = null;

async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

/** Emissor real: uma mensagem de relay por membro (`target.memberId` → sala `member:<id>`). */
export const relayProposalUpdate: ProposalUpdateEmitter = async ({
  workspaceId,
  memberIds,
  payload,
}) => {
  if (memberIds.length === 0) return;
  const { channel } = await getMqHandle();
  for (const memberId of memberIds) {
    const envelope = makeEnvelope('socket.relay', workspaceId, {
      event: 'copilot:proposal_updated',
      target: { memberId },
      data: payload,
    });
    channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
  }
};

/** Dependências de produção, com overrides (testes e composição). */
export function createProposalEngineDeps(
  overrides: Partial<ProposalEngineDeps> & { readonly executors: ExecutorRegistry },
): ProposalEngineDeps {
  return {
    emit: relayProposalUpdate,
    notify: notifyEvent,
    now: () => new Date(),
    logger: createLogger('info', { svc: '@hm/api', component: 'copilot-proposals' }),
    progressThrottleMs: 250,
    ...overrides,
  };
}
