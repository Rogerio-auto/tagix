/**
 * O que das tools do agente pode ir para `tool_logs` (F70-S23, L-b).
 *
 * `tool_logs.params`/`result` é trilha de auditoria, não cópia do atendimento. Os args
 * vêm do modelo, que repete o que o cliente disse (nome, CPF, telefone, e-mail), e o
 * resultado pode ecoar esses args. Por isso a regra é de **allowlist por tool**: cada
 * tool declara, campo a campo, o que pode ser registrado e como. Todo o resto é
 * mascarado RECURSIVAMENTE: sobra só a forma (tipo e, em objeto, as chaves), nunca o
 * valor. Tool sem política declarada tem tudo mascarado.
 *
 * Tipos de campo (`LogField`):
 *  - `id`: UUID. Outra coisa é mascarada;
 *  - `token`: identificador curto do sistema (enum, key, BCP 47, fuso IANA, moeda). Só
 *    passa `[A-Za-z0-9_./:+-]{1,64}` sem dígito em sequência longa (telefone/CPF colado
 *    num "enum" inventado pelo modelo vira máscara);
 *  - `number` / `boolean`: escalar do tipo certo;
 *  - `datetime`: ISO 8601;
 *  - `text`: texto livre do modelo. Sai sem dígitos nem e-mail, cortado em 120;
 *  - `{ each }`: array cujos itens seguem a regra dada (no máximo 50 itens);
 *  - `{ fields }`: objeto com política própria por chave;
 *  - `shape`: o campo é registrado, mas só a forma: escalar vira o tipo; objeto (ex.:
 *    `custom_fields`) mantém as chaves, mascaradas como texto, e os valores viram o tipo.
 *    É o mesmo tratamento de um campo fora da política; declarar serve para documentar
 *    que o campo é conhecido e é dado pessoal.
 *
 * Máscara de valor: `'[redacted:string]'`, `'[redacted:number]'`, `'[redacted:boolean]'`;
 * `null` continua `null` (não carrega dado); objeto e array mantêm a forma.
 */

export type LogField =
  | 'id'
  | 'token'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'text'
  | 'shape'
  | { readonly each: LogField }
  | { readonly fields: LogPolicy };

export type LogPolicy = Readonly<Record<string, LogField>>;

interface ToolLogPolicy {
  /** Args do modelo (`tool_logs.params`). */
  readonly params: LogPolicy;
  /** `payload` do handler (`tool_logs.result`). */
  readonly result: LogPolicy;
}

const TEXT_MAX = 120;
const ARRAY_MAX = 50;
const DEPTH_MAX = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_./:+-]{1,64}$/;
/** Quatro dígitos seguidos já é mais do que qualquer token do sistema precisa. */
const DIGIT_RUN_RE = /\d{4,}/;
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Sem e-mail e sem dígitos, cortado em `max` caracteres. */
export function maskText(value: string, max: number): string {
  const masked = value.replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/\d/g, '#');
  return masked.length > max ? `${masked.slice(0, max)}…` : masked;
}

/** Texto livre: sem e-mail, sem dígitos, no máximo 120 caracteres (L8, F70-S15). */
export function maskFreeText(value: string): string {
  return maskText(value, TEXT_MAX);
}

/** Mascara tudo, preservando só a forma (tipo; chaves em objeto, também mascaradas). */
function maskAll(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return '[redacted:string]';
  if (typeof value === 'number') return '[redacted:number]';
  if (typeof value === 'boolean') return '[redacted:boolean]';
  if (depth >= DEPTH_MAX) return '[redacted]';
  if (Array.isArray(value)) {
    const items = value.slice(0, ARRAY_MAX).map((v) => maskAll(v, depth + 1));
    return value.length > ARRAY_MAX ? [...items, `[+${value.length - ARRAY_MAX}]`] : items;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[maskFreeText(k)] = maskAll(v, depth + 1);
    return out;
  }
  return '[redacted]';
}

function applyField(field: LogField, value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (depth >= DEPTH_MAX) return maskAll(value, depth);
  if (typeof field === 'object') {
    if ('each' in field) {
      if (!Array.isArray(value)) return maskAll(value, depth);
      const items = value.slice(0, ARRAY_MAX).map((v) => applyField(field.each, v, depth + 1));
      return value.length > ARRAY_MAX ? [...items, `[+${value.length - ARRAY_MAX}]`] : items;
    }
    if (typeof value !== 'object' || Array.isArray(value)) return maskAll(value, depth);
    return applyPolicy(field.fields, value as Record<string, unknown>, depth + 1);
  }
  switch (field) {
    case 'id':
      return typeof value === 'string' && UUID_RE.test(value) ? value : maskAll(value, depth);
    case 'token':
      return typeof value === 'string' && TOKEN_RE.test(value) && !DIGIT_RUN_RE.test(value)
        ? value
        : maskAll(value, depth);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : maskAll(value, depth);
    case 'boolean':
      return typeof value === 'boolean' ? value : maskAll(value, depth);
    case 'datetime':
      return typeof value === 'string' && ISO_DATETIME_RE.test(value)
        ? value
        : value instanceof Date && Number.isFinite(value.getTime())
          ? value.toISOString()
          : maskAll(value, depth);
    case 'text':
      return typeof value === 'string' ? maskFreeText(value) : maskAll(value, depth);
    case 'shape':
      return maskAll(value, depth);
  }
}

function applyPolicy(
  policy: LogPolicy,
  value: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const field = Object.hasOwn(policy, key) ? policy[key] : undefined;
    out[field === undefined ? maskFreeText(key) : key] =
      field === undefined ? maskAll(v, depth + 1) : applyField(field, v, depth);
  }
  return out;
}

// ─── Políticas por tool ──────────────────────────────────────────────────────

const CONTENT_ONLY: LogPolicy = { content: 'text' };

/**
 * Política de cada tool com handler no endpoint interno. `content` (mensagem do Node ao
 * modelo, que pode repetir texto do modelo, como o título de um evento) é texto livre
 * em todas: vai ao `result` quando o handler não devolve `payload`.
 */
export const TOOL_LOG_POLICIES: Readonly<Record<string, ToolLogPolicy>> = {
  ping: { params: {}, result: { executionId: 'id' } },
  transfer_to_human: {
    params: { reason: 'text', department_id: 'id' },
    result: { aiMode: 'token', status: 'token' },
  },
  transfer_to_agent: {
    params: { targetAgentId: 'id', reason: 'text' },
    result: { targetAgentId: 'id', reengaged: 'boolean', noop: 'boolean' },
  },
  escalate: { params: { reason: 'text', severity: 'token' }, result: { severity: 'token' } },
  mark_resolved: { params: { resolution: 'text' }, result: { status: 'token' } },
  change_conversation_status: {
    params: { target_status: 'token', note: 'text' },
    result: { status: 'token' },
  },
  register_conversion: {
    params: {
      type_key: 'token',
      conversion_type_key: 'token',
      value_cents: 'number',
      currency: 'token',
      note: 'text',
      contact_id: 'id',
    },
    result: { conversionEventId: 'id', deduped: 'boolean' },
  },
  move_deal_stage: {
    params: { stage_id: 'id', deal_id: 'id' },
    result: { dealId: 'id', fromStageId: 'id', toStageId: 'id' },
  },
  add_contact_tag: {
    // O nome da etiqueta vem do modelo: pode ser um telefone "tentando" virar etiqueta.
    params: { tag: 'text' },
    result: { tagId: 'id', applied: 'boolean' },
  },
  update_contact: {
    // `display_name` e os valores de `custom_fields` são dado pessoal: nunca em claro.
    params: { language: 'token', timezone: 'token', display_name: 'shape', custom_fields: 'shape' },
    result: { updated: { each: 'token' } },
  },
  list_calendars: {
    params: { owner_member_id: 'id', type: 'token' },
    result: {
      calendars: {
        each: { fields: { id: 'id', name: 'text', type: 'token', is_default: 'boolean' } },
      },
    },
  },
  get_available_slots: {
    params: {
      date: 'datetime',
      member_id: 'id',
      calendar_id: 'id',
      interval_minutes: 'number',
      min_notice_minutes: 'number',
      buffer_minutes: 'number',
      max_slots: 'number',
    },
    result: {
      slots: {
        each: { fields: { start_at: 'datetime', end_at: 'datetime', duration_minutes: 'number' } },
      },
    },
  },
  schedule_event: {
    // Título, descrição, local e link são texto do modelo (nome do cliente, endereço).
    params: {
      title: 'text',
      start_at: 'datetime',
      end_at: 'datetime',
      calendar_id: 'id',
      type: 'token',
      priority: 'token',
      contact_id: 'id',
    },
    result: { event_id: 'id', title: 'text', start_at: 'datetime', end_at: 'datetime' },
  },
};

/** Args do modelo para `tool_logs.params`, pela política da tool (L-b). */
export function redactLogArgs(
  toolKey: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const policy = Object.hasOwn(TOOL_LOG_POLICIES, toolKey) ? TOOL_LOG_POLICIES[toolKey] : undefined;
  return applyPolicy(policy?.params ?? {}, args, 0);
}

/** Resultado do handler para `tool_logs.result`, pela política da tool (L-b). */
export function redactLogResult(toolKey: string, value: unknown): Record<string, unknown> {
  const policy = Object.hasOwn(TOOL_LOG_POLICIES, toolKey) ? TOOL_LOG_POLICIES[toolKey] : undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { value: maskAll(value) };
  }
  return applyPolicy(
    { ...CONTENT_ONLY, ...(policy?.result ?? {}) },
    value as Record<string, unknown>,
    0,
  );
}
