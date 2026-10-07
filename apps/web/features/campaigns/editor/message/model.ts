/**
 * Regra da etapa **Mensagem** do criador de campanha (F58-S09).
 *
 * Módulo PURO — sem React, sem rede — para ser testado isolado. A tela só
 * apresenta o que sai daqui.
 *
 * ## A tradução que o usuário nunca vê
 *
 * O payload do `PUT /api/campaigns/:id/steps` continua falando
 * `templateName` / `languageCode` / `bindings`. A pessoa escolhe "Confirmação de
 * pedido (Português)" num catálogo e diz "aqui vai o nome do contato"; quem
 * converte isso em contrato é `toStepsPayload`. O campo de nome técnico do modelo
 * deixou de existir na interface.
 *
 * ## Espelho do servidor
 *
 * A leitura dos componentes e a resolução de variáveis espelham
 * `apps/api/src/routes/campaigns/builder/render.ts` (F58-S06): mesma regra de
 * `{{n}}`, mesma posição 1-based de botão, mesmo fallback. A prévia é local para
 * responder a cada tecla; o servidor continua sendo quem valida no teste e no
 * preflight. Se as duas regras divergirem, os testes de paridade quebram.
 */

/* ── Contrato de variáveis (espelha `binding_contract/v1`) ───────────────── */

export type BindingComponent = 'header' | 'body' | 'button';

/** Campos nativos do contato que a API sabe resolver por destinatário. */
export type ContactField = 'displayName' | 'phone' | 'email';

export type BindingSource =
  | { readonly kind: 'fixed'; readonly value: string }
  | { readonly kind: 'contact'; readonly field: ContactField; readonly fallback: string }
  | { readonly kind: 'customField'; readonly key: string; readonly fallback: string };

export type BindingSourceKind = BindingSource['kind'];

/**
 * Variável mapeada. Durante a edição os textos podem estar vazios; o contrato
 * só sai daqui (`toStepsPayload`) depois de `validateMessages` sem pendências.
 */
export interface TemplateBinding {
  readonly component: BindingComponent;
  readonly index: number;
  readonly source: BindingSource;
}

/** Contato usado para mostrar um exemplo real na prévia. */
export interface ContactSample {
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly customFields: Readonly<Record<string, unknown>>;
}

/* ── Modelo aprovado (vindo de `GET /api/campaigns/builder/options`) ────── */

export interface TemplateOption {
  readonly id: string;
  readonly channelId: string;
  readonly name: string;
  readonly language: string;
  readonly category: string;
  readonly components: unknown;
}

export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | 'UNKNOWN';

export type ButtonKind = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'OTHER';

export interface TemplateButton {
  /** Posição 1-based, igual à do binding. */
  readonly position: number;
  readonly kind: ButtonKind;
  readonly text: string;
  readonly url: string | null;
  readonly phone: string | null;
  readonly hasVariable: boolean;
  /** Exemplo aprovado pela Meta para a parte variável do link. */
  readonly example: string | null;
}

export interface ParsedTemplate {
  readonly header: {
    readonly format: HeaderFormat;
    readonly text: string | null;
    readonly examples: readonly string[];
  } | null;
  readonly body: string;
  readonly bodyExamples: readonly string[];
  readonly footer: string | null;
  readonly buttons: readonly TemplateButton[];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function headerFormat(value: unknown): HeaderFormat {
  const raw = asText(value)?.toUpperCase();
  return raw === 'TEXT' ||
    raw === 'IMAGE' ||
    raw === 'VIDEO' ||
    raw === 'DOCUMENT' ||
    raw === 'LOCATION'
    ? raw
    : 'UNKNOWN';
}

function buttonKind(value: unknown): ButtonKind {
  const raw = asText(value)?.toUpperCase();
  return raw === 'QUICK_REPLY' || raw === 'URL' || raw === 'PHONE_NUMBER' ? raw : 'OTHER';
}

const VARIABLE_RE = /\{\{\s*(\d+)\s*\}\}/gu;

/** Números de `{{n}}` presentes no texto, únicos e em ordem. */
export function variableIndexes(text: string): number[] {
  const indexes = new Set<number>();
  for (const match of text.matchAll(VARIABLE_RE)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index > 0) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

/**
 * Lê os componentes sincronizados da Meta. `null` quando o formato é
 * irreconhecível — a tela trata como "sincronize de novo", nunca como vazio.
 */
export function parseTemplate(components: unknown): ParsedTemplate | null {
  if (!Array.isArray(components)) return null;

  let header: ParsedTemplate['header'] = null;
  let body = '';
  let bodyExamples: string[] = [];
  let footer: string | null = null;
  const buttons: TemplateButton[] = [];

  for (const raw of components) {
    const component = asRecord(raw);
    if (!component) continue;
    const type = asText(component['type'])?.toUpperCase();
    const text = asText(component['text']);
    const example = asRecord(component['example']);
    if (type === 'HEADER') {
      header = {
        format: headerFormat(component['format'] ?? 'TEXT'),
        text,
        examples: asStringList(example?.['header_text']),
      };
    } else if (type === 'BODY' && text !== null) {
      body = text;
      // A Meta guarda `body_text` como lista de listas (um conjunto por amostra).
      const sets = example?.['body_text'];
      bodyExamples = Array.isArray(sets) ? asStringList(sets[0]) : [];
    } else if (type === 'FOOTER' && text !== null) {
      footer = text;
    } else if (type === 'BUTTONS' && Array.isArray(component['buttons'])) {
      component['buttons'].forEach((rawButton, position) => {
        const button = asRecord(rawButton);
        if (!button) return;
        const url = asText(button['url']);
        buttons.push({
          position: position + 1,
          kind: buttonKind(button['type']),
          text: asText(button['text']) ?? '',
          url,
          phone: asText(button['phone_number']),
          hasVariable: url !== null && variableIndexes(url).length > 0,
          example: asStringList(button['example'])[0] ?? null,
        });
      });
    }
  }
  return { header, body, bodyExamples, footer, buttons };
}

/* ── Variáveis do modelo ─────────────────────────────────────────────────── */

export type SlotKey = `${BindingComponent}:${number}`;

export function slotKey(component: BindingComponent, index: number): SlotKey {
  return `${component}:${index}`;
}

export interface VariableSlot {
  readonly key: SlotKey;
  readonly component: BindingComponent;
  readonly index: number;
  /** Rótulo humano: "Texto · espaço 1", "Título", "Link do botão “Ver pedido”". */
  readonly label: string;
  /** Trecho do modelo em volta do espaço, para a pessoa saber onde ele cai. */
  readonly context: string;
  /** Exemplo que a Meta aprovou para este espaço (não é dado de contato). */
  readonly approvedExample: string | null;
}

/** Trecho de até ~40 caracteres de cada lado do `{{n}}`. */
function contextAround(text: string, index: number): string {
  const re = new RegExp(`\\{\\{\\s*${index}\\s*\\}\\}`, 'u');
  const match = re.exec(text);
  if (!match) return text.slice(0, 80);
  const start = Math.max(0, match.index - 40);
  const end = Math.min(text.length, match.index + match[0].length + 40);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/gu, ' ').trim()}${suffix}`;
}

/** Todos os espaços que o modelo exige preencher, na ordem em que aparecem. */
export function variableSlots(parsed: ParsedTemplate): VariableSlot[] {
  const slots: VariableSlot[] = [];
  const headerText = parsed.header?.format === 'TEXT' ? (parsed.header.text ?? '') : '';
  for (const index of variableIndexes(headerText)) {
    slots.push({
      key: slotKey('header', index),
      component: 'header',
      index,
      label: 'Título',
      context: contextAround(headerText, index),
      approvedExample: parsed.header?.examples[index - 1] ?? null,
    });
  }
  for (const index of variableIndexes(parsed.body)) {
    slots.push({
      key: slotKey('body', index),
      component: 'body',
      index,
      label: `Texto · espaço ${index}`,
      context: contextAround(parsed.body, index),
      approvedExample: parsed.bodyExamples[index - 1] ?? null,
    });
  }
  for (const button of parsed.buttons) {
    if (!button.hasVariable) continue;
    slots.push({
      key: slotKey('button', button.position),
      component: 'button',
      index: button.position,
      label: `Link do botão “${button.text || `botão ${button.position}`}”`,
      context: button.url ?? '',
      approvedExample: button.example,
    });
  }
  return slots;
}

/* ── Resolução de valores ────────────────────────────────────────────────── */

export const CONTACT_FIELD_LABEL: Readonly<Record<ContactField, string>> = {
  displayName: 'Nome do contato',
  phone: 'Telefone do contato',
  email: 'E-mail do contato',
};

export const SOURCE_KIND_LABEL: Readonly<Record<BindingSourceKind, string>> = {
  contact: 'Dado do contato',
  customField: 'Campo personalizado',
  fixed: 'Texto fixo',
};

export interface ResolvedValue {
  readonly value: string;
  /** `true` quando o contato não tinha o dado e o texto reserva entrou. */
  readonly usedFallback: boolean;
}

/** Mesmo cálculo do `resolveBinding` do servidor. */
export function resolveValue(source: BindingSource, contact: ContactSample | null): ResolvedValue {
  if (source.kind === 'fixed') return { value: source.value, usedFallback: false };
  if (source.kind === 'contact') {
    const value = contact?.[source.field];
    return typeof value === 'string' && value.trim().length > 0
      ? { value, usedFallback: false }
      : { value: source.fallback, usedFallback: true };
  }
  const value = contact?.customFields[source.key.trim()];
  if (typeof value === 'string' && value.trim().length > 0) return { value, usedFallback: false };
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value: String(value), usedFallback: false };
  }
  return { value: source.fallback, usedFallback: true };
}

/* ── Prévia segmentada (nunca HTML) ──────────────────────────────────────── */

export type PreviewSegment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'variable';
      readonly key: SlotKey;
      readonly text: string;
      /** Sem valor ainda: a prévia mostra o buraco em vez de esconder. */
      readonly missing: boolean;
      readonly usedFallback: boolean;
    };

/**
 * Quebra o texto em pedaços literais e variáveis já resolvidas. A tela
 * renderiza cada pedaço como nó de texto do React — não existe caminho daqui
 * para `innerHTML`, então um `<script>` vindo do modelo aparece como texto.
 */
export function segmentText(
  text: string,
  component: Exclude<BindingComponent, 'button'>,
  bindings: readonly TemplateBinding[],
  contact: ContactSample | null,
): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(VARIABLE_RE)) {
    const at = match.index ?? 0;
    if (at > cursor) segments.push({ kind: 'text', text: text.slice(cursor, at) });
    const index = Number(match[1]);
    const binding = bindings.find((b) => b.component === component && b.index === index);
    const resolved = binding ? resolveValue(binding.source, contact) : null;
    const value = resolved?.value.trim() ?? '';
    segments.push({
      kind: 'variable',
      key: slotKey(component, index),
      text: value.length > 0 ? (resolved?.value ?? '') : `{{${index}}}`,
      missing: value.length === 0,
      usedFallback: resolved?.usedFallback ?? false,
    });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

/** Link final de um botão com variável (o que o destinatário abre). */
export function resolveButtonUrl(
  button: TemplateButton,
  bindings: readonly TemplateBinding[],
  contact: ContactSample | null,
): string | null {
  if (button.url === null) return null;
  if (!button.hasVariable) return button.url;
  const binding = bindings.find((b) => b.component === 'button' && b.index === button.position);
  const value = binding ? resolveValue(binding.source, contact).value : '';
  return button.url.replace(VARIABLE_RE, value.trim().length > 0 ? value : '…');
}

/* ── Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```mono```) ── */

export type TextStyle = 'plain' | 'bold' | 'italic' | 'strike' | 'mono';

export interface StyledRun {
  readonly style: TextStyle;
  readonly text: string;
}

const STYLE_RE = /```([^`]+)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/gu;

/**
 * Aplica a marcação do WhatsApp num trecho literal. Sem aninhamento — o próprio
 * WhatsApp é inconsistente com ele, e uma prévia que promete mais do que o
 * aparelho mostra é pior que uma prévia simples.
 */
export function styleRuns(text: string): StyledRun[] {
  const runs: StyledRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(STYLE_RE)) {
    const at = match.index ?? 0;
    if (at > cursor) runs.push({ style: 'plain', text: text.slice(cursor, at) });
    if (match[1] !== undefined) runs.push({ style: 'mono', text: match[1] });
    else if (match[2] !== undefined) runs.push({ style: 'bold', text: match[2] });
    else if (match[3] !== undefined) runs.push({ style: 'italic', text: match[3] });
    else if (match[4] !== undefined) runs.push({ style: 'strike', text: match[4] });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) runs.push({ style: 'plain', text: text.slice(cursor) });
  return runs;
}

/* ── Rascunho da etapa ───────────────────────────────────────────────────── */

export type DelayUnit = 'minutes' | 'hours' | 'days';

export interface Delay {
  readonly amount: number;
  readonly unit: DelayUnit;
}

export const UNIT_SECONDS: Readonly<Record<DelayUnit, number>> = {
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

/** Teto de espera entre duas mensagens: depois disso a conversa já esfriou. */
export const MAX_DELAY_SECONDS = 90 * UNIT_SECONDS.days;

export interface MessageDraft {
  /** Chave local estável (reordenar não pode remontar o formulário errado). */
  readonly key: string;
  /** `null` em rascunho hidratado do servidor até casar com o catálogo. */
  readonly templateId: string | null;
  readonly templateName: string;
  readonly languageCode: string;
  readonly bindings: readonly TemplateBinding[];
  /** Espera depois da mensagem anterior. Ignorado na primeira. */
  readonly delay: Delay;
}

export interface MessageStepValue {
  readonly messages: readonly MessageDraft[];
  /** Sequência: para de enviar as próximas quando a pessoa responde. */
  readonly stopOnReply: boolean;
}

export type CampaignMode = 'single' | 'sequence';

/** Limite de mensagens numa sequência. Mais que isso é spam, não cadência. */
export const MAX_SEQUENCE_MESSAGES = 8;

const DEFAULT_DELAY: Delay = { amount: 1, unit: 'days' };

let keySeed = 0;
function nextKey(): string {
  keySeed += 1;
  return `msg-${Date.now().toString(36)}-${keySeed}`;
}

export function blankMessage(key: string = nextKey()): MessageDraft {
  return {
    key,
    templateId: null,
    templateName: '',
    languageCode: '',
    bindings: [],
    delay: DEFAULT_DELAY,
  };
}

export function emptyMessageStep(): MessageStepValue {
  return { messages: [blankMessage()], stopOnReply: true };
}

export function delayToSeconds(delay: Delay): number {
  return Math.round(delay.amount) * UNIT_SECONDS[delay.unit];
}

/** Maior unidade que representa o valor sem fração (172800 s → 2 dias). */
export function secondsToDelay(seconds: number): Delay {
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_DELAY;
  for (const unit of ['days', 'hours', 'minutes'] as const) {
    const size = UNIT_SECONDS[unit];
    if (seconds % size === 0) return { amount: seconds / size, unit };
  }
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' };
}

const UNIT_WORD: Readonly<Record<DelayUnit, readonly [string, string]>> = {
  minutes: ['minuto', 'minutos'],
  hours: ['hora', 'horas'],
  days: ['dia', 'dias'],
};

export function unitWord(unit: DelayUnit, amount: number): string {
  const [one, many] = UNIT_WORD[unit];
  return amount === 1 ? one : many;
}

/** "2 dias depois da mensagem anterior" — a frase que a tela mostra. */
export function describeDelay(delay: Delay): string {
  const amount = Math.round(delay.amount);
  return `${amount} ${unitWord(delay.unit, amount)} depois da mensagem anterior`;
}

/* ── Escolha do modelo ───────────────────────────────────────────────────── */

/**
 * Variáveis iniciais ao escolher um modelo. O que a pessoa já tinha mapeado no
 * mesmo espaço é preservado (trocar de modelo parecido não zera o trabalho).
 *
 * Nenhum valor é inventado: o primeiro espaço do texto sugere o nome do
 * contato — o caso mais comum —, mas o texto reserva fica vazio e é exigido.
 * Um exemplo aprovado da Meta ("João") preenchido sozinho iria para mil pessoas.
 */
export function bindingsForTemplate(
  parsed: ParsedTemplate,
  previous: readonly TemplateBinding[],
): TemplateBinding[] {
  return variableSlots(parsed).map((slot) => {
    const kept = previous.find((b) => b.component === slot.component && b.index === slot.index);
    if (kept) return kept;
    const source: BindingSource =
      slot.component === 'body' && slot.index === 1
        ? { kind: 'contact', field: 'displayName', fallback: '' }
        : { kind: 'fixed', value: '' };
    return { component: slot.component, index: slot.index, source };
  });
}

export function selectTemplate(draft: MessageDraft, template: TemplateOption): MessageDraft {
  const parsed = parseTemplate(template.components);
  return {
    ...draft,
    templateId: template.id,
    templateName: template.name,
    languageCode: template.language,
    bindings: parsed ? bindingsForTemplate(parsed, draft.bindings) : [],
  };
}

/** Troca a origem de um espaço preservando o que fizer sentido. */
export function changeSourceKind(source: BindingSource, kind: BindingSourceKind): BindingSource {
  if (source.kind === kind) return source;
  const fallback = source.kind === 'fixed' ? '' : source.fallback;
  if (kind === 'fixed')
    return { kind: 'fixed', value: source.kind === 'fixed' ? source.value : '' };
  if (kind === 'contact') return { kind: 'contact', field: 'displayName', fallback };
  return { kind: 'customField', key: '', fallback };
}

export function updateBinding(
  draft: MessageDraft,
  key: SlotKey,
  source: BindingSource,
): MessageDraft {
  const exists = draft.bindings.some((b) => slotKey(b.component, b.index) === key);
  if (!exists) {
    // Rascunho hidratado de um step legado não traz o espaço: cria ao editar.
    const [component, rawIndex] = key.split(':') as [BindingComponent, string];
    return {
      ...draft,
      bindings: [...draft.bindings, { component, index: Number(rawIndex), source }],
    };
  }
  return {
    ...draft,
    bindings: draft.bindings.map((b) =>
      slotKey(b.component, b.index) === key ? { ...b, source } : b,
    ),
  };
}

/**
 * Casa o rascunho com o catálogo de modelos aprovados. Por id quando houver;
 * por nome + idioma no rascunho vindo do servidor (o step persiste o nome).
 * `null` = o modelo não está mais aprovado e disponível neste canal.
 */
export function resolveTemplate(
  draft: MessageDraft,
  approved: readonly TemplateOption[],
): TemplateOption | null {
  if (draft.templateId !== null) {
    const byId = approved.find((t) => t.id === draft.templateId);
    if (byId) return byId;
  }
  if (draft.templateName.length === 0) return null;
  return (
    approved.find((t) => t.name === draft.templateName && t.language === draft.languageCode) ?? null
  );
}

/**
 * Rascunho vindo do servidor só conhece nome + idioma. Quando o catálogo chega,
 * amarra o id e completa os espaços que faltarem (sem tocar nos já mapeados).
 * Devolve o MESMO objeto quando nada muda — o chamador usa isso para não entrar
 * em laço de atualização.
 */
export function attachResolvedTemplates(
  value: MessageStepValue,
  approved: readonly TemplateOption[],
): MessageStepValue {
  let changed = false;
  const messages = value.messages.map((draft) => {
    if (draft.templateId !== null) return draft;
    const template = resolveTemplate(draft, approved);
    if (!template) return draft;
    changed = true;
    return selectTemplate(draft, template);
  });
  return changed ? { ...value, messages } : value;
}

/* ── Sequência ───────────────────────────────────────────────────────────── */

export function addMessage(value: MessageStepValue): MessageStepValue {
  if (value.messages.length >= MAX_SEQUENCE_MESSAGES) return value;
  return { ...value, messages: [...value.messages, blankMessage()] };
}

export function removeMessage(value: MessageStepValue, key: string): MessageStepValue {
  if (value.messages.length <= 1) return value;
  return { ...value, messages: value.messages.filter((m) => m.key !== key) };
}

/** Move a mensagem `key` uma posição (`-1` sobe, `1` desce). Fora do limite: no-op. */
export function moveMessage(
  value: MessageStepValue,
  key: string,
  direction: -1 | 1,
): MessageStepValue {
  const from = value.messages.findIndex((m) => m.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= value.messages.length) return value;
  const next = [...value.messages];
  const moving = next[from];
  const target = next[to];
  if (moving === undefined || target === undefined) return value;
  next[from] = target;
  next[to] = moving;
  return { ...value, messages: next };
}

export function patchMessage(
  value: MessageStepValue,
  key: string,
  patch: (draft: MessageDraft) => MessageDraft,
): MessageStepValue {
  return { ...value, messages: value.messages.map((m) => (m.key === key ? patch(m) : m)) };
}

/** Envio único usa só a primeira mensagem; o resto não pode ir para o servidor. */
export function messagesForMode(
  value: MessageStepValue,
  mode: CampaignMode,
): readonly MessageDraft[] {
  return mode === 'single' ? value.messages.slice(0, 1) : value.messages;
}

/* ── Validação ───────────────────────────────────────────────────────────── */

export type MessageIssueCode =
  | 'template_missing'
  | 'template_unavailable'
  | 'template_invalid'
  | 'variable_missing'
  | 'fixed_empty'
  | 'fallback_empty'
  | 'custom_key_empty'
  | 'delay_invalid'
  | 'sequence_too_short';

export interface MessageIssue {
  readonly code: MessageIssueCode;
  readonly messageKey: string | null;
  readonly slot?: SlotKey;
  readonly text: string;
}

export interface ValidationContext {
  readonly mode: CampaignMode;
  readonly approved: readonly TemplateOption[];
  /** Catálogo ainda carregando: não dá para afirmar que o modelo sumiu. */
  readonly catalogReady: boolean;
}

function bindingIssues(
  binding: TemplateBinding,
  messageKey: string,
  label: string,
  where: string,
): MessageIssue[] {
  const slot = slotKey(binding.component, binding.index);
  const source = binding.source;
  if (source.kind === 'fixed') {
    return source.value.trim().length === 0
      ? [{ code: 'fixed_empty', messageKey, slot, text: `Escreva o texto de “${label}”${where}.` }]
      : [];
  }
  const issues: MessageIssue[] = [];
  if (source.kind === 'customField' && source.key.trim().length === 0) {
    issues.push({
      code: 'custom_key_empty',
      messageKey,
      slot,
      text: `Diga qual campo personalizado vai em “${label}”${where}.`,
    });
  }
  if (source.fallback.trim().length === 0) {
    issues.push({
      code: 'fallback_empty',
      messageKey,
      slot,
      text: `Defina o texto reserva de “${label}”${where} para quem não tiver esse dado.`,
    });
  }
  return issues;
}

/**
 * Tudo o que impede avançar, de uma vez. Lista vazia = etapa pronta.
 * Formulário que revela um erro por vez faz a pessoa clicar cinco vezes.
 */
export function validateMessages(value: MessageStepValue, ctx: ValidationContext): MessageIssue[] {
  const issues: MessageIssue[] = [];
  const messages = messagesForMode(value, ctx.mode);

  if (ctx.mode === 'sequence' && messages.length < 2) {
    issues.push({
      code: 'sequence_too_short',
      messageKey: null,
      text: 'Uma sequência precisa de pelo menos duas mensagens.',
    });
  }

  messages.forEach((draft, position) => {
    const where = ctx.mode === 'sequence' ? ` (mensagem ${position + 1})` : '';
    if (draft.templateId === null && draft.templateName.length === 0) {
      issues.push({
        code: 'template_missing',
        messageKey: draft.key,
        text: `Escolha um modelo aprovado${where}.`,
      });
      return;
    }
    const template = resolveTemplate(draft, ctx.approved);
    if (template === null) {
      issues.push({
        code: 'template_unavailable',
        messageKey: draft.key,
        text: ctx.catalogReady
          ? `O modelo escolhido não está mais aprovado${where}. Escolha outro ou sincronize.`
          : `Conferindo se o modelo continua aprovado${where}…`,
      });
      return;
    }
    const parsed = parseTemplate(template.components);
    if (parsed === null) {
      issues.push({
        code: 'template_invalid',
        messageKey: draft.key,
        text: `Não conseguimos ler este modelo${where}. Sincronize os modelos novamente.`,
      });
      return;
    }
    for (const slot of variableSlots(parsed)) {
      const binding = draft.bindings.find(
        (b) => b.component === slot.component && b.index === slot.index,
      );
      if (!binding) {
        issues.push({
          code: 'variable_missing',
          messageKey: draft.key,
          slot: slot.key,
          text: `Defina o valor de “${slot.label}”${where}.`,
        });
        continue;
      }
      issues.push(...bindingIssues(binding, draft.key, slot.label, where));
    }
    if (ctx.mode === 'sequence' && position > 0) {
      const seconds = delayToSeconds(draft.delay);
      if (
        !Number.isFinite(seconds) ||
        seconds < UNIT_SECONDS.minutes ||
        seconds > MAX_DELAY_SECONDS
      ) {
        issues.push({
          code: 'delay_invalid',
          messageKey: draft.key,
          text: `Escolha uma espera entre 1 minuto e 90 dias${where}.`,
        });
      }
    }
  });
  return issues;
}

/* ── Contrato com a API (a tradução escondida) ───────────────────────────── */

export interface StepPayload {
  readonly position: number;
  readonly templateName: string;
  readonly languageCode: string;
  readonly delaySeconds: number;
  readonly stopOnReply: boolean;
  readonly bindings: TemplateBinding[];
}

function trimSource(source: BindingSource): BindingSource {
  if (source.kind === 'fixed') return { kind: 'fixed', value: source.value.trim() };
  if (source.kind === 'contact') {
    return { kind: 'contact', field: source.field, fallback: source.fallback.trim() };
  }
  return { kind: 'customField', key: source.key.trim(), fallback: source.fallback.trim() };
}

/**
 * Corpo do `PUT /api/campaigns/:id/steps`. Só chame com `validateMessages`
 * vazio: aqui não se inventa valor. Variáveis que o modelo não usa (sobra de uma
 * troca de modelo) ficam de fora — a API recusaria como `VARIABLE_UNUSED`.
 */
export function toStepsPayload(
  value: MessageStepValue,
  mode: CampaignMode,
  approved: readonly TemplateOption[],
): StepPayload[] {
  return messagesForMode(value, mode).map((draft, position) => {
    const template = resolveTemplate(draft, approved);
    const parsed = template ? parseTemplate(template.components) : null;
    const wanted = new Set(parsed ? variableSlots(parsed).map((s) => s.key) : []);
    return {
      position,
      templateName: template?.name ?? draft.templateName,
      languageCode: template?.language ?? draft.languageCode,
      delaySeconds: mode === 'sequence' && position > 0 ? delayToSeconds(draft.delay) : 0,
      stopOnReply: value.stopOnReply,
      bindings: draft.bindings
        .filter((b) => wanted.has(slotKey(b.component, b.index)))
        .map((b) => ({ ...b, source: trimSource(b.source) }))
        .sort((a, b) =>
          a.component === b.component ? a.index - b.index : a.component.localeCompare(b.component),
        ),
    };
  });
}

/** Variáveis prontas para `POST /builder/test` e `/builder/preview`. */
export function bindingsForRequest(
  draft: MessageDraft,
  template: TemplateOption,
): TemplateBinding[] {
  const parsed = parseTemplate(template.components);
  const wanted = new Set(parsed ? variableSlots(parsed).map((s) => s.key) : []);
  return draft.bindings
    .filter((b) => wanted.has(slotKey(b.component, b.index)))
    .map((b) => ({ ...b, source: trimSource(b.source) }));
}

/* ── Hidratação (GET /api/campaigns/:id → etapa) ─────────────────────────── */

export interface StoredStep {
  readonly position: number;
  readonly templateName: string;
  readonly languageCode: string;
  readonly templateComponents: readonly unknown[] | null;
  readonly delaySeconds: number;
  readonly stopOnReply: boolean;
}

const COMPONENTS = new Set<BindingComponent>(['header', 'body', 'button']);
const FIELDS = new Set<ContactField>(['displayName', 'phone', 'email']);

function decodeSource(raw: unknown): BindingSource | null {
  const source = asRecord(raw);
  if (!source) return null;
  const kind = source['kind'];
  if (kind === 'fixed' && typeof source['value'] === 'string') {
    return { kind: 'fixed', value: source['value'] };
  }
  const fallback = typeof source['fallback'] === 'string' ? source['fallback'] : null;
  if (fallback === null) return null;
  if (kind === 'contact' && FIELDS.has(source['field'] as ContactField)) {
    return { kind: 'contact', field: source['field'] as ContactField, fallback };
  }
  if (kind === 'customField' && typeof source['key'] === 'string') {
    return { kind: 'customField', key: source['key'], fallback };
  }
  return null;
}

/**
 * Lê o envelope `binding_contract/v1` gravado na posição 0 de
 * `template_components`. Componentes Graph legados não são variáveis mapeadas:
 * devolvem lista vazia e a pessoa remapeia ao abrir.
 */
export function decodeStoredBindings(components: readonly unknown[] | null): TemplateBinding[] {
  if (!components || components.length !== 1) return [];
  const envelope = asRecord(components[0]);
  if (!envelope || envelope['type'] !== 'binding_contract' || envelope['version'] !== 1) return [];
  const list = envelope['bindings'];
  if (!Array.isArray(list)) return [];
  const out: TemplateBinding[] = [];
  for (const raw of list) {
    const item = asRecord(raw);
    if (!item) continue;
    const component = item['component'];
    const index = item['index'];
    const source = decodeSource(item['source']);
    if (
      typeof component === 'string' &&
      COMPONENTS.has(component as BindingComponent) &&
      typeof index === 'number' &&
      Number.isInteger(index) &&
      index > 0 &&
      source !== null
    ) {
      out.push({ component: component as BindingComponent, index, source });
    }
  }
  return out;
}

export function fromStoredSteps(steps: readonly StoredStep[]): MessageStepValue {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return emptyMessageStep();
  return {
    messages: ordered.map((step) => ({
      key: nextKey(),
      templateId: null,
      templateName: step.templateName,
      languageCode: step.languageCode,
      bindings: decodeStoredBindings(step.templateComponents),
      delay: secondsToDelay(step.delaySeconds),
    })),
    stopOnReply: ordered.every((step) => step.stopOnReply),
  };
}

/* ── Catálogo: filtros em linguagem simples ──────────────────────────────── */

export interface CatalogFilters {
  readonly search: string;
  /** `''` = todas. */
  readonly category: string;
  /** `''` = todos. */
  readonly language: string;
}

export const EMPTY_FILTERS: CatalogFilters = { search: '', category: '', language: '' };

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Nome técnico em forma legível: `pedido_confirmado_v2` → "Pedido confirmado v2". */
export function friendlyTemplateName(name: string): string {
  const words = name.replaceAll('_', ' ').replace(/\s+/gu, ' ').trim();
  return words.length === 0 ? 'Modelo sem nome' : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Busca no nome legível E no texto da mensagem — a pessoa lembra do que a
 * mensagem diz, não do identificador que alguém digitou na Meta.
 */
export function filterTemplates(
  templates: readonly TemplateOption[],
  filters: CatalogFilters,
): TemplateOption[] {
  const terms = normalize(filters.search).split(/\s+/u).filter(Boolean);
  return templates.filter((template) => {
    if (filters.category && template.category !== filters.category) return false;
    if (filters.language && template.language !== filters.language) return false;
    if (terms.length === 0) return true;
    const body = parseTemplate(template.components)?.body ?? '';
    const haystack = normalize(`${friendlyTemplateName(template.name)} ${template.name} ${body}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/** Valores presentes no catálogo, para o filtro só oferecer o que existe. */
export function facetValues(
  templates: readonly TemplateOption[],
  field: 'category' | 'language',
): string[] {
  return [...new Set(templates.map((t) => t[field]))].sort();
}
