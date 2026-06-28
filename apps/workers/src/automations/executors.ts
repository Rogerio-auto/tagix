/**
 * Roteador de actions de automacao (PIPELINE.md 3.1). Recebe uma
 * PendingAutomationRow e despacha para o handler da action via PORTAS injetadas
 * (DI) — este pacote NAO implementa as actions cross-dominio:
 *   - trigger_flow            -> @hm/flow-engine (F4)
 *   - add_tag / remove_tag    -> aplicacao de tag (F5-S16)
 *   - register_conversion     -> API/servico de conversoes (F5-S14)
 *   - send_message / notify_members / create_event -> handlers de canal/calendario
 *
 * Portas ausentes lancam (vai p/ retry/failed) — explicitamente NAO silenciam,
 * p/ nao "engolir" verde falso. O bootstrap injeta as portas disponiveis.
 */
import type { CreateEventPort } from './create-event-port';
import type { ActionExecutor, PendingAutomationRow } from './types';

export interface ActionPorts {
  triggerFlow?: (ctx: { workspaceId: string; dealId: string; flowId: string }) => Promise<void>;
  sendMessage?: (
    ctx: { workspaceId: string; dealId: string },
    config: { templateName: string; languageCode: string; channelId: string },
  ) => Promise<void>;
  notifyMembers?: (
    ctx: { workspaceId: string; dealId: string },
    config: { memberIds: string[]; title: string; body: string },
  ) => Promise<void>;
  /** Port `create_event` (F53-S07): cria compromisso reusando `@hm/db.calendarRepo`. */
  createEvent?: CreateEventPort;
  addTag?: (ctx: { workspaceId: string; dealId: string; tagId: string }) => Promise<void>;
  removeTag?: (ctx: { workspaceId: string; dealId: string; tagId: string }) => Promise<void>;
  registerConversion?: (
    ctx: { workspaceId: string; dealId: string },
    config: { conversionTypeKey: string; valueFrom: string; valueCents?: number },
  ) => Promise<void>;
}

class MissingPortError extends Error {
  constructor(action: string) {
    super(`Automation action sem handler injetado: ${action}`);
    this.name = 'MissingPortError';
  }
}

/** Constroi o ActionExecutor a partir das portas disponiveis. */
export function createActionExecutor(ports: ActionPorts): ActionExecutor {
  return async (row: PendingAutomationRow): Promise<void> => {
    const { rule } = row;
    const ctx = { workspaceId: row.workspaceId, dealId: row.dealId };
    const config = rule.config;
    switch (config.kind) {
      case 'trigger_flow':
        if (!ports.triggerFlow) throw new MissingPortError('trigger_flow');
        return ports.triggerFlow({ ...ctx, flowId: config.flowId });
      case 'send_message':
        if (!ports.sendMessage) throw new MissingPortError('send_message');
        return ports.sendMessage(ctx, config);
      case 'notify_members':
        if (!ports.notifyMembers) throw new MissingPortError('notify_members');
        return ports.notifyMembers(ctx, config);
      case 'create_event':
        if (!ports.createEvent) throw new MissingPortError('create_event');
        return ports.createEvent(ctx, config);
      case 'add_tag':
        if (!ports.addTag) throw new MissingPortError('add_tag');
        return ports.addTag({ ...ctx, tagId: config.tagId });
      case 'remove_tag':
        if (!ports.removeTag) throw new MissingPortError('remove_tag');
        return ports.removeTag({ ...ctx, tagId: config.tagId });
      case 'register_conversion':
        if (!ports.registerConversion) throw new MissingPortError('register_conversion');
        return ports.registerConversion(ctx, config);
      default: {
        const _exhaustive: never = config;
        throw new Error(`Action desconhecida: ${JSON.stringify(_exhaustive)}`);
      }
    }
  };
}

export { MissingPortError };
