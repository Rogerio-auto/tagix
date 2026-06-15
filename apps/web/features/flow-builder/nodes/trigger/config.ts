/**
 * Metadados e helpers do node `trigger` (F31-S07). Fonte unica de verdade para:
 *   - os 8 tipos de gatilho (espelha `flows.triggerType` + `trigger.handler.ts`);
 *   - as opcoes de cada `trigger_config` (rotulos PT, valores estaveis);
 *   - leitura tipada de `node.data.{triggerType,triggerConfig}` (zero `any`);
 *   - validacao inline e resumo legivel para o node no canvas.
 *
 * As CHAVES de config sao o contrato com o dispatcher inbound
 * (`apps/workers/src/flows-triggers/dispatcher.ts`) e com `flow_submissions`:
 *   keyword        → `keywords: string[]` (+ `keyword` espelhado p/ compat) + `match_mode`
 *   new_message    → `message_types: string[]`
 *   new_lead       → `source: string`
 *   stage_change   → `from_stage_id`, `to_stage_id` (`pipeline_id` so filtra a UI)
 *   tag_added      → `tag_id`
 *   system_event   → `event`
 *   flow_submission→ `meta_flow_id`
 */
import type { ComboboxOption } from '../../inspector/pickers';

export const TRIGGER_TYPES = [
  'manual',
  'keyword',
  'new_message',
  'new_lead',
  'stage_change',
  'tag_added',
  'system_event',
  'flow_submission',
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

const TRIGGER_TYPE_SET: ReadonlySet<string> = new Set(TRIGGER_TYPES);

export interface TriggerTypeOption {
  readonly value: TriggerType;
  readonly label: string;
  readonly description: string;
}

/** Opcoes do seletor de tipo de gatilho (editavel apos a criacao). */
export const TRIGGER_TYPE_OPTIONS: readonly TriggerTypeOption[] = [
  {
    value: 'manual',
    label: 'Manual (botao na conversa)',
    description: 'Dispara quando um atendente aciona o flow dentro da conversa.',
  },
  {
    value: 'keyword',
    label: 'Palavra-chave na mensagem',
    description: 'Dispara quando a mensagem do contato casa com uma das palavras-chave.',
  },
  {
    value: 'new_message',
    label: 'Nova mensagem',
    description: 'Dispara a cada nova mensagem do contato, opcionalmente por tipo.',
  },
  {
    value: 'new_lead',
    label: 'Novo contato',
    description: 'Dispara quando um novo contato e criado, opcionalmente por origem.',
  },
  {
    value: 'stage_change',
    label: 'Mudanca de etapa',
    description: 'Dispara quando um negocio muda de etapa no pipeline.',
  },
  {
    value: 'tag_added',
    label: 'Tag aplicada',
    description: 'Dispara quando uma tag e aplicada ao contato.',
  },
  {
    value: 'system_event',
    label: 'Evento do sistema',
    description: 'Dispara a partir de um evento interno da plataforma.',
  },
  {
    value: 'flow_submission',
    label: 'Resposta de formulario (Meta Flow)',
    description: 'Dispara quando um Meta Flow especifico e respondido.',
  },
];

export interface LabeledOption {
  readonly value: string;
  readonly label: string;
}

/** Modos de comparacao da palavra-chave. */
export const MATCH_MODE_OPTIONS: readonly LabeledOption[] = [
  { value: 'contains', label: 'Contem' },
  { value: 'exact', label: 'Exata' },
  { value: 'starts_with', label: 'Comeca com' },
];

export const DEFAULT_MATCH_MODE = 'contains';

/** Tipos de mensagem aceitos (espelha o dominio de `messages.type`). */
export const MESSAGE_TYPE_OPTIONS: readonly LabeledOption[] = [
  { value: 'text', label: 'Texto' },
  { value: 'image', label: 'Imagem' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documento' },
  { value: 'sticker', label: 'Figurinha' },
  { value: 'location', label: 'Localizacao' },
  { value: 'contact', label: 'Contato' },
];

/** Origem do novo contato (vazio = qualquer). */
export const SOURCE_OPTIONS: readonly LabeledOption[] = [
  { value: '', label: 'Qualquer origem' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'webchat', label: 'Webchat' },
  { value: 'api', label: 'API' },
  { value: 'manual', label: 'Cadastro manual' },
];

/** Eventos internos sugeridos (Combobox aceita valor livre para casos avancados). */
export const SYSTEM_EVENT_OPTIONS: readonly ComboboxOption[] = [
  { value: 'conversation.opened', label: 'Conversa aberta' },
  { value: 'conversation.closed', label: 'Conversa encerrada' },
  { value: 'conversation.assigned', label: 'Conversa atribuida' },
  { value: 'contact.created', label: 'Contato criado' },
  { value: 'contact.updated', label: 'Contato atualizado' },
  { value: 'deal.created', label: 'Negocio criado' },
  { value: 'deal.won', label: 'Negocio ganho' },
  { value: 'deal.lost', label: 'Negocio perdido' },
];

// ── Leitura tipada de node.data ───────────────────────────────────────────────

/** Le o tipo de gatilho do `node.data` (default `manual` quando ausente/invalido). */
export function readTriggerType(data: Record<string, unknown>): TriggerType {
  const raw = data['triggerType'];
  return typeof raw === 'string' && TRIGGER_TYPE_SET.has(raw) ? (raw as TriggerType) : 'manual';
}

/** Le o objeto `trigger_config` do `node.data` (sempre um objeto). */
export function readTriggerConfig(data: Record<string, unknown>): Record<string, unknown> {
  const raw = data['triggerConfig'];
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export function readString(config: Record<string, unknown>, key: string): string {
  const raw = config[key];
  return typeof raw === 'string' ? raw : '';
}

export function readStringArray(config: Record<string, unknown>, key: string): string[] {
  const raw = config[key];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

// ── Validacao inline ──────────────────────────────────────────────────────────

/** Retorna a mensagem de erro de config (DS v2) ou `null` quando valida. */
export function validateTriggerConfig(
  type: TriggerType,
  config: Record<string, unknown>,
): string | null {
  switch (type) {
    case 'keyword':
      return readStringArray(config, 'keywords').length === 0
        ? 'Adicione ao menos uma palavra-chave para o gatilho disparar.'
        : null;
    case 'flow_submission':
      return readString(config, 'meta_flow_id').trim().length === 0
        ? 'Informe o Meta Flow que dispara este flow.'
        : null;
    default:
      return null;
  }
}

// ── Resumo legivel (node do canvas) ───────────────────────────────────────────

export interface TriggerNameResolvers {
  readonly stageName?: (id: string) => string | undefined;
  readonly tagName?: (id: string) => string | undefined;
}

function labelOf(options: readonly LabeledOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Frase curta que descreve a config do gatilho para exibir no node. */
export function summarizeTrigger(
  type: TriggerType,
  config: Record<string, unknown>,
  resolvers: TriggerNameResolvers = {},
): string | null {
  switch (type) {
    case 'keyword': {
      const keywords = readStringArray(config, 'keywords');
      return keywords.length > 0 ? keywords.join(', ') : null;
    }
    case 'new_message': {
      const types = readStringArray(config, 'message_types');
      if (types.length === 0) return 'Qualquer mensagem';
      return types.map((t) => labelOf(MESSAGE_TYPE_OPTIONS, t)).join(', ');
    }
    case 'new_lead': {
      const source = readString(config, 'source');
      return source ? labelOf(SOURCE_OPTIONS, source) : 'Qualquer origem';
    }
    case 'stage_change': {
      const from = readString(config, 'from_stage_id');
      const to = readString(config, 'to_stage_id');
      if (!from && !to) return 'Qualquer mudanca';
      const fromLabel = from ? (resolvers.stageName?.(from) ?? 'etapa') : 'qualquer';
      const toLabel = to ? (resolvers.stageName?.(to) ?? 'etapa') : 'qualquer';
      return `${fromLabel} → ${toLabel}`;
    }
    case 'tag_added': {
      const tag = readString(config, 'tag_id');
      if (!tag) return 'Qualquer tag';
      return resolvers.tagName?.(tag) ?? 'Tag configurada';
    }
    case 'system_event': {
      const event = readString(config, 'event');
      return event ? (labelOf([...SYSTEM_EVENT_OPTIONS], event) || event) : null;
    }
    case 'flow_submission': {
      const id = readString(config, 'meta_flow_id');
      return id ? `Meta Flow ${id}` : null;
    }
    case 'manual':
    default:
      return null;
  }
}
