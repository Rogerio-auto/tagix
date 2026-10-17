/**
 * Executores FAKE e dependências de teste do motor de propostas (F73-S05). Só para testes.
 *
 * O motor é provado sem domínio: o "registro" é um mapa em memória com versão por alvo, e o
 * executor confere a versão antes de escrever (como o real fará com `deals.updated_at`).
 * `deal.move` (nível base 2, desfazível) e `campaign.pause` (nível 4, externo, MANAGERS) cobrem
 * os quatro tratamentos sem tocar em tabela de negócio.
 *
 * Escopo fino como o real: um registro com `ownerId` só é visível para um AGENT se ele for o
 * dono ("Atendente: só os seus negócios"); gestores veem tudo. Cada item feito agenda um efeito
 * pós-commit (`afterCommitEvents`), para provar que nada sai antes do commit.
 */
import { z } from 'zod';
import { createLogger } from '@hm/logger';
import type { CopilotProposalUpdatedPayload, PolicyCheck } from '@hm/shared';
import type {
  CapabilityExecutor,
  ExecutableItem,
  ExecuteItemResult,
  ExecutorContext,
  Target,
} from '../../../internal/copilot/core/executor-types';
import type { NotifiableEvent } from '../../notifications';
import { createExecutorRegistry } from './deps';
import type { ProposalEngineDeps } from './types';

export interface FakeRecord {
  value: string;
  version: number;
  editedBy: string | null;
  /** Invisível para o membro (fora do escopo). */
  hidden?: boolean;
  /** Dono: um AGENT só vê o que é dele. */
  ownerId?: string;
}

export class FakeStore {
  readonly records = new Map<string, FakeRecord>();
  readonly executeCalls: string[] = [];
  readonly undoCalls: string[] = [];
  policy: PolicyCheck['status'] = 'ok';
  /** Efeitos pós-commit que o executor agendou e o motor de fato rodou. */
  readonly afterCommitEvents: string[] = [];
  /** Gancho chamado ANTES de cada `executeItem` (índice da chamada, item). */
  onExecute: ((index: number, item: ExecutableItem) => void) | null = null;

  add(id: string, value = 'Orçamento enviado', ownerId?: string): void {
    this.records.set(id, {
      value,
      version: 1,
      editedBy: null,
      ...(ownerId ? { ownerId } : {}),
    });
  }

  /** O principal do contexto enxerga o registro? */
  visible(id: string, ctx: Pick<ExecutorContext, 'principal'>): FakeRecord | null {
    const rec = this.records.get(id);
    if (!rec || rec.hidden) return null;
    if (rec.ownerId && ctx.principal.role === 'AGENT' && ctx.principal.memberId !== rec.ownerId) {
      return null;
    }
    return rec;
  }

  /** Alguém editou o alvo fora do Copiloto. */
  touch(id: string, by: string, value?: string): void {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.version++;
    rec.editedBy = by;
    if (value !== undefined) rec.value = value;
  }

  countExecutions(id: string): number {
    return this.executeCalls.filter((x) => x === id).length;
  }
}

export const FakeArgsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(250),
    to: z.string().min(1).max(160),
    notify: z.boolean().optional(),
  })
  .strict();
export type FakeArgs = z.infer<typeof FakeArgsSchema>;

function makeFakeExecutor(
  store: FakeStore,
  capability: 'deal.move' | 'campaign.pause',
): CapabilityExecutor<FakeArgs> {
  const targetType = capability === 'deal.move' ? 'deal' : 'campaign';
  const toTarget = (id: string, rec: FakeRecord): Target => ({
    type: targetType,
    id,
    label: `Registro ${id.slice(0, 8)}`,
    expectedVersion: String(rec.version),
    state: { value: rec.value },
  });
  return {
    capability,
    argsSchema: FakeArgsSchema,
    // Permissão de entidade (como o real): mover negócios exige ver o pipeline.
    ...(capability === 'deal.move' ? { requires: ['pipeline.view'] as const } : {}),
    adjustableParams: ['target_stage_id', 'notify_members'],
    applyAdjustments(args, params) {
      return {
        ...args,
        ...(params.target_stage_id ? { to: `Estágio ${params.target_stage_id.slice(0, 8)}` } : {}),
        ...(params.notify_members !== undefined ? { notify: params.notify_members } : {}),
      };
    },
    async resolveTargets(ctx, args) {
      const targets: Target[] = [];
      const dropped: { id: string; reason: 'not_found' }[] = [];
      for (const id of args.ids) {
        const rec = store.visible(id, ctx);
        if (!rec) dropped.push({ id, reason: 'not_found' });
        else targets.push(toTarget(id, rec));
      }
      return { targets, dropped };
    },
    async resolveIds(ctx, refs) {
      const targets: Target[] = [];
      const dropped: { id: string; reason: 'not_found' }[] = [];
      for (const ref of refs) {
        const rec = ref.type === targetType ? store.visible(ref.id, ctx) : null;
        if (!rec) dropped.push({ id: ref.id, reason: 'not_found' });
        else targets.push(toTarget(ref.id, rec));
      }
      return { targets, dropped };
    },
    async preview(_ctx, args, targets) {
      return {
        items: targets.map((t) => ({
          targetId: t.id,
          before: typeof t.state['value'] === 'string' ? t.state['value'] : null,
          after: args.to,
          plannedAfter: { value: args.to },
        })),
        impact: { notified_members: [], affected_count: targets.length, criterion: 'teste' },
        external: false,
        irreversible: false,
        notifiesMembers: args.notify === true,
        summary: `Mover ${targets.length} registros para ${args.to}`,
      };
    },
    ...(capability === 'campaign.pause'
      ? {
          async policyCheck(): Promise<PolicyCheck[]> {
            return [
              {
                key: 'send_window',
                status: store.policy,
                label: 'Janela de envio',
                detail: store.policy === 'block' ? 'Fora do horário' : 'Dentro do horário',
              },
            ];
          },
        }
      : {}),
    async executeItem(ctx, args, item): Promise<ExecuteItemResult> {
      const index = store.executeCalls.length;
      store.executeCalls.push(item.targetId);
      store.onExecute?.(index, item);
      const rec = store.records.get(item.targetId);
      if (!rec) return { status: 'failed', errorCode: 'not_found' };
      if (String(rec.version) !== item.expectedVersion) {
        return {
          status: 'skipped_conflict',
          ...(rec.editedBy ? { conflictBy: rec.editedBy } : {}),
        };
      }
      const before = rec.value;
      rec.value = args.to;
      rec.version++;
      rec.editedBy = null;
      ctx.afterCommit(() => {
        store.afterCommitEvents.push(`exec:${item.targetId}`);
      });
      return { status: 'done', after: { value: rec.value }, undoPayload: { value: before } };
    },
    async undoItem(_ctx, item) {
      store.undoCalls.push(item.targetId);
      const rec = store.records.get(item.targetId);
      if (!rec) return { status: 'failed', errorCode: 'not_found' };
      if (rec.value !== item.after?.['value']) return { status: 'undo_conflict' };
      const back = item.undoPayload?.['value'];
      if (typeof back !== 'string') return { status: 'failed' };
      rec.value = back;
      rec.version++;
      return { status: 'undone' };
    },
  };
}

export function fakeDealMoveExecutor(store: FakeStore): CapabilityExecutor<FakeArgs> {
  return makeFakeExecutor(store, 'deal.move');
}

export function fakeCampaignPauseExecutor(store: FakeStore): CapabilityExecutor<FakeArgs> {
  return makeFakeExecutor(store, 'campaign.pause');
}

export interface TestDeps extends ProposalEngineDeps {
  readonly emitted: {
    workspaceId: string;
    memberIds: readonly string[];
    payload: CopilotProposalUpdatedPayload;
  }[];
  readonly notified: NotifiableEvent[];
}

export function makeTestDeps(store: FakeStore): TestDeps {
  const emitted: TestDeps['emitted'] = [];
  const notified: NotifiableEvent[] = [];
  return {
    executors: createExecutorRegistry([
      fakeDealMoveExecutor(store),
      fakeCampaignPauseExecutor(store),
    ]),
    emit: async (input) => {
      emitted.push({ ...input });
    },
    notify: async (event) => {
      notified.push(event);
    },
    now: () => new Date(),
    logger: createLogger('error', { svc: '@hm/api', component: 'copilot-proposals-test' }),
    progressThrottleMs: 0,
    emitted,
    notified,
  };
}

/** Redis em memória com `SET NX PX` e o script de liberação (lock da varredura). */
export function fakeSweepRedis(): {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  readonly store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    async set(key, value) {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async eval(_script, _n, key, token) {
      if (key !== undefined && store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}
