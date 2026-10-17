/**
 * Catálogo de capacidades do Copiloto (COPILOTO.md §6.2, ADR-003, ADR-004).
 *
 * É o único lugar que diz o que o Copiloto pode fazer, quanto cada coisa arrisca na base e
 * qual permissão de `ROLE_CAN` ela exige. Capacidade nova entra AQUI primeiro (ADR-004
 * §Consequências), com nível base, permissão e desfazer; só depois ganha ferramenta.
 *
 * Fora da v1 e sem ferramenta exposta: criar ou alterar automações, excluir qualquer coisa,
 * gestão de membros, configurações do workspace, cobrança e integrações.
 *
 * Puro: sem IO, importável por API, workers e navegador.
 */
import { can, ROLES, type Permission, type Role } from '../permissions';

export const CAPABILITY_KEYS = [
  'query',
  'contact.tag',
  'contact.update',
  'deal.assign_owner',
  'deal.move',
  'conversation.note',
  'event.create_internal',
  'memory.remember',
  'message.send',
  'campaign.pause',
  'campaign.resume',
  'campaign.cancel',
  'flow.trigger',
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Nível de risco base do catálogo. 3 nunca é base: só nasce de volume, aviso ou contaminação. */
export type CapabilityBaseRisk = 1 | 2 | 4;

/** Permissão exigida: fixa, ou dependente do volume de alvos (`message.send`). */
export type CapabilityPermission = Permission | ((targetCount: number) => Permission);

export interface CapabilityDef {
  readonly key: CapabilityKey;
  /** Nome curto, pt-BR, para a tela de configurações e a Atividade. */
  readonly label: string;
  /** Uma frase do que faz. Para pessoas, não para o modelo. */
  readonly description: string;
  readonly kind: 'query' | 'write';
  readonly baseRisk: CapabilityBaseRisk;
  readonly permission: CapabilityPermission;
  /** Fala com quem está fora da empresa (cliente, contato). Sempre nível 4. */
  readonly external: boolean;
  /** Não tem volta depois de executado. Sempre nível 4. */
  readonly irreversible: boolean;
  /** O executor implementa `undoItem`. */
  readonly undoable: boolean;
  /** Escopo fino aplicado no service (ex.: "só os seus" do AGENT). Texto para a interface. */
  readonly scopeNote?: string;
}

/**
 * Rótulos pt-BR por capacidade.
 *
 * - `name`: nome na matriz de configurações (A11) e na Atividade (A8);
 * - `description`: ajuda curta da linha da matriz;
 * - `status`: rótulo do evento SSE `status` antes da ferramenta. Vem SEMPRE daqui, nunca do
 *   modelo: um rótulo escrito pelo modelo é uma superfície de injeção visual
 *   ("Lendo dados do Banco Central…").
 */
export const CAPABILITY_LABELS_PT = {
  query: {
    name: 'Consultar dados',
    description: 'Ler, somar, comparar, resumir e prever a partir do que você já pode ver.',
    status: 'Consultando os dados…',
  },
  'contact.tag': {
    name: 'Marcar contatos',
    description: 'Adicionar ou remover tags de contatos.',
    status: 'Preparando as tags…',
  },
  'contact.update': {
    name: 'Editar contato',
    description: 'Alterar campos editáveis de um contato.',
    status: 'Preparando a edição do contato…',
  },
  'deal.assign_owner': {
    name: 'Trocar responsável',
    description: 'Passar negócios para outra pessoa da equipe.',
    status: 'Preparando a troca de responsável…',
  },
  'deal.move': {
    name: 'Mover negócios',
    description: 'Mudar negócios de estágio, respeitando as regras do pipeline.',
    status: 'Preparando a movimentação…',
  },
  'conversation.note': {
    name: 'Nota interna',
    description: 'Escrever uma nota interna numa conversa. O cliente não vê.',
    status: 'Preparando a nota…',
  },
  'event.create_internal': {
    name: 'Agendar compromisso interno',
    description: 'Criar um compromisso na agenda, sem aviso ao cliente.',
    status: 'Preparando o compromisso…',
  },
  'memory.remember': {
    name: 'Ensinar um fato',
    description: 'Guardar um fato na memória do negócio, com fonte.',
    status: 'Preparando o fato para a memória…',
  },
  'message.send': {
    name: 'Mandar mensagem',
    description: 'Enviar mensagem a um ou mais contatos, sempre com prévia e revisão.',
    status: 'Preparando a mensagem…',
  },
  'campaign.pause': {
    name: 'Pausar campanha',
    description: 'Pausar o envio de uma campanha em andamento.',
    status: 'Conferindo a campanha…',
  },
  'campaign.resume': {
    name: 'Retomar campanha',
    description: 'Retomar o envio de uma campanha pausada.',
    status: 'Conferindo a campanha…',
  },
  'campaign.cancel': {
    name: 'Cancelar campanha',
    description: 'Cancelar uma campanha de vez. Oferece pausar em vez disso.',
    status: 'Conferindo a campanha…',
  },
  'flow.trigger': {
    name: 'Disparar flow',
    description: 'Iniciar um flow para contatos.',
    status: 'Preparando o disparo do flow…',
  },
} as const satisfies Record<
  CapabilityKey,
  { readonly name: string; readonly description: string; readonly status: string }
>;

/**
 * Rótulos de `status` das consultas, por área lida. `query` é uma capacidade só, mas o
 * rótulo diz o que está sendo lido ("Lendo o pipeline…"). A ferramenta de consulta declara
 * a área; o rótulo continua vindo do catálogo.
 */
export const QUERY_AREAS = [
  'pipeline',
  'contacts',
  'conversations',
  'calendar',
  'campaigns',
  'knowledge',
  'members',
  'forecast',
] as const;
export type QueryArea = (typeof QUERY_AREAS)[number];

export const QUERY_STATUS_LABELS_PT = {
  pipeline: 'Lendo o pipeline…',
  contacts: 'Procurando contatos…',
  conversations: 'Lendo as conversas…',
  calendar: 'Olhando a agenda…',
  campaigns: 'Lendo as campanhas…',
  knowledge: 'Consultando o conhecimento…',
  members: 'Conferindo a equipe…',
  forecast: 'Calculando a previsão…',
} as const satisfies Record<QueryArea, string>;

/** Fase pública do `status` (COPILOTO.md §5.3). */
export type CopilotStatusPhase = 'thinking' | 'reading' | 'acting';

/** Rótulo e fase do `status` de uma ferramenta, sempre do catálogo. */
export function statusLabelFor(
  capability: CapabilityKey,
  area?: QueryArea,
): { readonly phase: CopilotStatusPhase; readonly label: string } {
  if (capability === 'query') {
    return {
      phase: 'reading',
      label: area === undefined ? CAPABILITY_LABELS_PT.query.status : QUERY_STATUS_LABELS_PT[area],
    };
  }
  return { phase: 'acting', label: CAPABILITY_LABELS_PT[capability].status };
}

/** `message.send`: 1 alvo é atendimento (`conversation.assign`); 2 ou mais é disparo (`campaign.edit`). */
function messageSendPermission(targetCount: number): Permission {
  return targetCount <= 1 ? 'conversation.assign' : 'campaign.edit';
}

const L = CAPABILITY_LABELS_PT;

export const CAPABILITIES = {
  query: {
    key: 'query',
    label: L.query.name,
    description: L.query.description,
    kind: 'query',
    baseRisk: 1,
    // A capacidade abre a superfície; cada ferramenta de consulta exige ainda a permissão
    // da entidade (pipeline.view, contact.view, conversation.view, calendar.view,
    // campaign.list/view_metrics, agent.list), checada no callback (F73-S03/S06/S07).
    permission: 'copilot.use',
    external: false,
    irreversible: false,
    undoable: false,
    scopeNote: 'Só o que você já vê nas telas.',
  },
  'contact.tag': {
    key: 'contact.tag',
    label: L['contact.tag'].name,
    description: L['contact.tag'].description,
    kind: 'write',
    baseRisk: 2,
    permission: 'contact.edit',
    external: false,
    irreversible: false,
    undoable: true,
  },
  'contact.update': {
    key: 'contact.update',
    label: L['contact.update'].name,
    description: L['contact.update'].description,
    kind: 'write',
    baseRisk: 2,
    permission: 'contact.edit',
    external: false,
    irreversible: false,
    undoable: true,
  },
  'deal.assign_owner': {
    key: 'deal.assign_owner',
    label: L['deal.assign_owner'].name,
    description: L['deal.assign_owner'].description,
    kind: 'write',
    baseRisk: 2,
    permission: 'deal.edit',
    external: false,
    irreversible: false,
    undoable: true,
  },
  'deal.move': {
    key: 'deal.move',
    label: L['deal.move'].name,
    description: L['deal.move'].description,
    kind: 'write',
    baseRisk: 2,
    permission: 'deal.move',
    // Estático `false`: mover só vira externo quando a automação do estágio (on_enter/on_exit)
    // manda mensagem, dispara flow ou registra conversão. Isso é calculado pelo executor
    // (F73-S08) e entra no `classifyRisk` como `external: true` (nível 4).
    external: false,
    irreversible: false,
    undoable: true,
    scopeNote: 'Atendente: só os seus negócios.',
  },
  'conversation.note': {
    key: 'conversation.note',
    label: L['conversation.note'].name,
    description: L['conversation.note'].description,
    kind: 'write',
    baseRisk: 2,
    permission: 'conversation.assign',
    external: false,
    irreversible: false,
    undoable: true,
    scopeNote: 'Só em conversas que você vê.',
  },
  'event.create_internal': {
    key: 'event.create_internal',
    label: L['event.create_internal'].name,
    description: L['event.create_internal'].description,
    kind: 'write',
    baseRisk: 2,
    permission: 'event.edit',
    external: false,
    irreversible: false,
    undoable: true,
  },
  'memory.remember': {
    key: 'memory.remember',
    label: L['memory.remember'].name,
    description: L['memory.remember'].description,
    kind: 'write',
    baseRisk: 2,
    permission: 'copilot.memory.edit',
    external: false,
    irreversible: false,
    undoable: true,
  },
  'message.send': {
    key: 'message.send',
    label: L['message.send'].name,
    description: L['message.send'].description,
    kind: 'write',
    baseRisk: 4,
    permission: messageSendPermission,
    external: true,
    irreversible: true,
    // Mensagem enviada não volta. A exceção (envio agendado, cancelável até sair) é do
    // executor (F73-S09), que declara o desfazer por proposta.
    undoable: false,
    scopeNote: '1 contato: conversas que você vê. 2 ou mais: quem pode editar campanhas.',
  },
  'campaign.pause': {
    key: 'campaign.pause',
    label: L['campaign.pause'].name,
    description: L['campaign.pause'].description,
    kind: 'write',
    baseRisk: 4,
    permission: 'campaign.pause',
    external: true,
    irreversible: false,
    undoable: true,
  },
  'campaign.resume': {
    key: 'campaign.resume',
    label: L['campaign.resume'].name,
    description: L['campaign.resume'].description,
    kind: 'write',
    baseRisk: 4,
    permission: 'campaign.pause',
    external: true,
    irreversible: false,
    undoable: true,
  },
  'campaign.cancel': {
    key: 'campaign.cancel',
    label: L['campaign.cancel'].name,
    description: L['campaign.cancel'].description,
    kind: 'write',
    baseRisk: 4,
    permission: 'campaign.cancel',
    external: true,
    irreversible: true,
    undoable: false,
  },
  'flow.trigger': {
    key: 'flow.trigger',
    label: L['flow.trigger'].name,
    description: L['flow.trigger'].description,
    kind: 'write',
    baseRisk: 4,
    permission: 'flow.trigger',
    external: true,
    irreversible: false,
    undoable: true,
    scopeNote: 'O desfazer cancela as execuções que ainda não rodaram.',
  },
} as const satisfies Record<CapabilityKey, CapabilityDef>;

/** A capacidade é de escrita? */
export function isWriteCapability(key: CapabilityKey): boolean {
  return CAPABILITIES[key].kind === 'write';
}

/** Permissão de `ROLE_CAN` exigida para `targetCount` alvos. */
export function capabilityPermission(key: CapabilityKey, targetCount = 1): Permission {
  const def: CapabilityDef = CAPABILITIES[key];
  return typeof def.permission === 'function' ? def.permission(targetCount) : def.permission;
}

/**
 * Matriz de `copilot_settings.capability_matrix`: `{ papel: { capacidade: bool } }`.
 * Ausente = herda a permissão do papel. `false` = desligado pelo dono. `true` nunca concede
 * o que o papel não tem: a matriz só RESTRINGE.
 *
 * A chave reservada `use` desliga o Copiloto inteiro para o papel (seção "Quem pode usar"
 * da A11). Não é capacidade: é o interruptor do papel, guardado na mesma linha da matriz
 * para não exigir coluna nova.
 */
export const COPILOT_MATRIX_USE_KEY = 'use' as const;
export type CapabilityMatrixKey = CapabilityKey | typeof COPILOT_MATRIX_USE_KEY;
export type CapabilityMatrix = Partial<
  Record<Role, Partial<Record<CapabilityMatrixKey, boolean>>>
>;

export interface EffectiveCapability {
  readonly allowed: boolean;
  /** Presente só quando `allowed = false`. `role` vence: o papel nem tem a permissão. */
  readonly reason?: 'role' | 'disabled_by_owner';
}
export type EffectiveCapabilities = Record<CapabilityKey, EffectiveCapability>;

/** O papel pode usar o Copiloto? `can(role, 'copilot.use') ∧ matriz[role].use ≠ false`. */
export function copilotAccessFor(
  role: Role,
  matrix: CapabilityMatrix | null | undefined,
): EffectiveCapability {
  if (!can(role, 'copilot.use')) return { allowed: false, reason: 'role' };
  if (matrix?.[role]?.[COPILOT_MATRIX_USE_KEY] === false) {
    return { allowed: false, reason: 'disabled_by_owner' };
  }
  return { allowed: true };
}

/**
 * Pode usar a capacidade com `targetCount` alvos?
 * `efetiva = can(role, perm(targetCount)) ∧ copilot.use ∧ matriz[role][cap] ≠ false` (§6.2).
 * É o que o callback (F73-S03) recalcula a cada chamada, com o volume real.
 */
export function capabilityAllowed(
  role: Role,
  matrix: CapabilityMatrix | null | undefined,
  key: CapabilityKey,
  targetCount = 1,
): EffectiveCapability {
  const access = copilotAccessFor(role, matrix);
  if (!access.allowed) return access;
  if (!can(role, capabilityPermission(key, targetCount))) return { allowed: false, reason: 'role' };
  if (matrix?.[role]?.[key] === false) return { allowed: false, reason: 'disabled_by_owner' };
  return { allowed: true };
}

/**
 * Capacidades efetivas do papel, para `GET /api/copilot/me`, para a matriz da A11 e para
 * filtrar as ferramentas oferecidas ao modelo.
 *
 * Responde "pode usar em algum volume": a permissão é avaliada para 1 alvo, o caso menos
 * exigente. O limite por volume (`message.send` com 2+ alvos) é checado na chamada, por
 * `capabilityAllowed` com a contagem real.
 */
export function effectiveCapabilities(
  role: Role,
  matrix: CapabilityMatrix | null | undefined,
): EffectiveCapabilities {
  const out = {} as Record<CapabilityKey, EffectiveCapability>;
  for (const key of CAPABILITY_KEYS) out[key] = capabilityAllowed(role, matrix, key, 1);
  return out;
}

/** O papel tem a permissão de domínio (sem olhar a matriz)? Para a célula "o papel não permite". */
export function roleHasCapability(role: Role, key: CapabilityKey): boolean {
  return can(role, 'copilot.use') && can(role, capabilityPermission(key, 1));
}

/** Os 5 papéis reais, na ordem da matriz da A11. */
export const COPILOT_MATRIX_ROLES: readonly Role[] = ROLES;
