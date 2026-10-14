/**
 * Variáveis da mensagem de campanha resolvidas POR DESTINATÁRIO (F58-S12).
 *
 * O criador guiado (F58-S06) grava em `campaign_steps.template_components` o contrato
 * `binding_contract/v1` — DE ONDE vem cada variável (`fixed`, campo do contato, campo
 * personalizado), com fallback obrigatório — e não um texto já resolvido. Antes deste
 * slot o disparo copiava esse envelope cru para o job; o worker outbound o recusava
 * (`type: 'binding_contract'` não é componente da Graph) e a mensagem morria na DLQ.
 *
 * Aqui o contrato vira componentes da Graph, um destinatário por vez, DENTRO da transação
 * do disparo — o job publicado já carrega os valores daquele contato e de mais nenhum. A
 * função é pura: entra o contato, sai o componente; nada fica em cache entre chamadas.
 *
 * Mesma semântica da prévia da API (`apps/api/src/routes/campaigns/builder/render.ts`),
 * que é o que o usuário viu antes de iniciar:
 *  - `header`/`body`: `index` é o número do placeholder `{{n}}` (1-based);
 *  - `button`: `index` é a POSIÇÃO do botão (1-based); a Graph recebe `index` 0-based em
 *    string e o `sub_type` do botão (`url` para botão com variável).
 * O contrato vive duplicado nos dois apps porque nenhum pacote compartilhado o hospeda
 * ainda (ver nota do slot); o teste de contrato daqui trava o formato persistido.
 */
import { z } from 'zod';
import { templateComponentSchema } from '../../outbound/job';
import type { TemplateComponent } from '@hm/channels';

/** Envelope persistido pelo criador: `[{ type: 'binding_contract', version: 1, bindings }]`. */
export const BINDING_CONTRACT_TYPE = 'binding_contract' as const;
export const BINDING_CONTRACT_VERSION = 1 as const;

const fallbackSchema = z.string().trim().min(1).max(1_000);

const bindingSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), value: z.string().trim().min(1).max(1_000) }),
  z.object({
    kind: z.literal('contact'),
    field: z.enum(['displayName', 'phone', 'email']),
    fallback: fallbackSchema,
  }),
  z.object({
    kind: z.literal('customField'),
    key: z.string().trim().min(1).max(120),
    fallback: fallbackSchema,
  }),
]);

export const templateBindingSchema = z.object({
  component: z.enum(['header', 'body', 'button']),
  index: z.number().int().min(1).max(100),
  source: bindingSourceSchema,
});

export type TemplateBinding = z.infer<typeof templateBindingSchema>;

const bindingContractSchema = z.object({
  type: z.literal(BINDING_CONTRACT_TYPE),
  version: z.literal(BINDING_CONTRACT_VERSION),
  bindings: z.array(templateBindingSchema).max(100),
});

/** Dados do contato que alimentam as variáveis. */
export interface RecipientContact {
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly customFields: Readonly<Record<string, unknown>> | null;
}

/** Por que o passo não pôde virar mensagem (vira pausa da campanha, não falha por contato). */
export type RenderFailureReason = 'template_variables_mismatch' | 'template_components_invalid';

export type RenderComponentsOutcome =
  | { readonly ok: true; readonly components: readonly TemplateComponent[] }
  | {
      readonly ok: false;
      readonly reason: RenderFailureReason;
      /** Chaves `componente:índice` envolvidas (para log e suporte; sem valores do contato). */
      readonly detail: readonly string[];
    };

/** O valor gravado no passo é o envelope de variáveis? Devolve as variáveis, ou `null`. */
export function decodeBindingContract(value: unknown): readonly TemplateBinding[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const first: unknown = value[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return null;
  if ((first as Record<string, unknown>)['type'] !== BINDING_CONTRACT_TYPE) return null;
  const parsed = bindingContractSchema.safeParse(first);
  return parsed.success ? parsed.data.bindings : null;
}

/** `true` quando o valor parece o envelope (mesmo inválido): nunca pode ir cru para a Graph. */
function looksLikeBindingContract(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        (item as Record<string, unknown>)['type'] === BINDING_CONTRACT_TYPE,
    )
  );
}

// ─── Modelo sincronizado da Meta ─────────────────────────────────────────────────

interface CatalogButton {
  /** Posição 1-based. */
  readonly position: number;
  readonly kind: string;
  readonly hasVariable: boolean;
}

interface CatalogShape {
  readonly headerText: string | null;
  readonly body: string;
  readonly buttons: readonly CatalogButton[];
}

const VARIABLE_RE = /\{\{\s*(\d+)\s*\}\}/gu;

function variableIndexes(text: string): number[] {
  const out = new Set<number>();
  for (const match of text.matchAll(VARIABLE_RE)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Lê os componentes da Meta (`HEADER`/`BODY`/`BUTTONS`). `null` = formato irreconhecível. */
function parseCatalog(components: unknown): CatalogShape | null {
  if (!Array.isArray(components)) return null;
  let headerText: string | null = null;
  let body = '';
  const buttons: CatalogButton[] = [];
  for (const raw of components) {
    const c = asRecord(raw);
    if (c === null) continue;
    const type = asText(c['type'])?.toUpperCase();
    if (type === 'HEADER') {
      const format = asText(c['format'])?.toUpperCase() ?? 'TEXT';
      headerText = format === 'TEXT' ? asText(c['text']) : null;
    } else if (type === 'BODY') {
      body = asText(c['text']) ?? '';
    } else if (type === 'BUTTONS' && Array.isArray(c['buttons'])) {
      c['buttons'].forEach((rawButton: unknown, i: number) => {
        const b = asRecord(rawButton);
        if (b === null) return;
        const url = asText(b['url']);
        buttons.push({
          position: i + 1,
          kind: (asText(b['type']) ?? 'OTHER').toUpperCase(),
          hasVariable: url !== null && variableIndexes(url).length > 0,
        });
      });
    }
  }
  return { headerText, body, buttons };
}

function requiredKeys(shape: CatalogShape): Set<string> {
  const keys = new Set<string>();
  for (const n of variableIndexes(shape.headerText ?? '')) keys.add(`header:${n}`);
  for (const n of variableIndexes(shape.body)) keys.add(`body:${n}`);
  for (const b of shape.buttons) if (b.hasVariable) keys.add(`button:${b.position}`);
  return keys;
}

// ─── Valor de uma variável para UM contato ───────────────────────────────────────

/**
 * Parâmetro de texto aceito pela Graph: sem quebra de linha/tab e sem 4+ espaços
 * seguidos (a Meta recusa o envio inteiro com 132000/131008). Normaliza em vez de
 * falhar; o que sobrar vazio cai no fallback.
 */
export function normalizeParameter(value: string): string {
  return value
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/ {4,}/gu, '   ')
    .trim()
    .slice(0, 1_000);
}

function dynamicValue(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  return null;
}

/** Valor de uma variável para ESTE contato; o fallback cobre campo vazio ou ausente. */
export function resolveBinding(binding: TemplateBinding, contact: RecipientContact): string {
  const source = binding.source;
  if (source.kind === 'fixed') return normalizeParameter(source.value);
  const raw =
    source.kind === 'contact' ? contact[source.field] : contact.customFields?.[source.key];
  const value = dynamicValue(raw);
  const normalized = value === null ? '' : normalizeParameter(value);
  return normalized.length > 0 ? normalized : normalizeParameter(source.fallback);
}

// ─── Componentes da Graph do passo, para UM destinatário ────────────────────────

/**
 * Monta os componentes do template para um destinatário.
 *
 * - Passo com contrato de variáveis: resolve cada variável com os dados DESTE contato. Com
 *   o modelo sincronizado em mãos, confere que o conjunto de variáveis ainda é o que o
 *   modelo exige (o modelo pode ter sido editado na Meta depois de a campanha nascer):
 *   divergência pausa a campanha em vez de mandar mil mensagens recusadas.
 * - Passo legado (componentes da Graph já prontos): segue como está, validado.
 */
export function renderRecipientComponents(input: {
  readonly stepComponents: unknown;
  /** `components` do modelo sincronizado (`channel_message_templates`), ou `null`. */
  readonly catalogComponents: unknown;
  readonly contact: RecipientContact;
}): RenderComponentsOutcome {
  const bindings = decodeBindingContract(input.stepComponents);
  if (bindings === null) {
    if (looksLikeBindingContract(input.stepComponents)) {
      return { ok: false, reason: 'template_components_invalid', detail: ['binding_contract'] };
    }
    const legacy = z.array(templateComponentSchema).safeParse(input.stepComponents ?? []);
    if (!legacy.success) {
      return { ok: false, reason: 'template_components_invalid', detail: ['legacy_components'] };
    }
    return { ok: true, components: legacy.data };
  }

  const catalog = input.catalogComponents === null ? null : parseCatalog(input.catalogComponents);
  if (catalog !== null) {
    const required = requiredKeys(catalog);
    const provided = new Set(bindings.map((b) => `${b.component}:${b.index}`));
    const mismatch = [
      ...[...required].filter((k) => !provided.has(k)),
      ...[...provided].filter((k) => !required.has(k)),
    ];
    if (mismatch.length > 0) {
      return { ok: false, reason: 'template_variables_mismatch', detail: mismatch.sort() };
    }
  }

  const byComponent = (component: TemplateBinding['component']): TemplateBinding[] =>
    bindings.filter((b) => b.component === component).sort((a, b) => a.index - b.index);

  const components: TemplateComponent[] = [];
  for (const component of ['header', 'body'] as const) {
    const list = byComponent(component);
    if (list.length === 0) continue;
    components.push({
      type: component,
      parameters: list.map((b) => ({ type: 'text', text: resolveBinding(b, input.contact) })),
    });
  }
  for (const b of byComponent('button')) {
    const button = catalog?.buttons.find((candidate) => candidate.position === b.index);
    components.push({
      type: 'button',
      // Só botão de URL tem variável de texto; sem o modelo em mãos, `url` é o único válido.
      sub_type: button === undefined || button.kind === 'URL' ? 'url' : button.kind.toLowerCase(),
      index: String(b.index - 1),
      parameters: [{ type: 'text', text: resolveBinding(b, input.contact) }],
    });
  }
  return { ok: true, components };
}
